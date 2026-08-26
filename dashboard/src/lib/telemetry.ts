/** Lightweight browser performance instrumentation for the dashboard. */

export interface PageTiming {
  path: string;
  loadMs: number;
  domContentLoadedMs: number;
  timestamp: number;
}

export interface TelemetryEvent {
  name: string;
  attributes: Record<string, string | number | boolean>;
  timestamp: number;
}

const timings: PageTiming[] = [];
const events: TelemetryEvent[] = [];

export function recordPageTiming(path: string): void {
  if (typeof performance === 'undefined') return;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return;
  timings.push({
    path,
    loadMs: Math.round(nav.loadEventEnd - nav.startTime),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
    timestamp: Date.now(),
  });
  if (timings.length > 100) timings.shift();
  recordEvent('page.load', { path, loadMs: timings[timings.length - 1]!.loadMs });
}

export function recordEvent(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
): void {
  events.push({ name, attributes, timestamp: Date.now() });
  if (events.length > 200) events.shift();
}

export function getPageTimings(): readonly PageTiming[] {
  return timings;
}

export function getTelemetryEvents(): readonly TelemetryEvent[] {
  return events;
}

export interface HealthSnapshot {
  sdkTelemetryEnabled: boolean;
  indexerEndpoint: string;
  indexerHealthy: boolean | null;
  indexerLagLedgers: number | null;
  indexerNextLedger: number | null;
  otelCollectorReachable: boolean | null;
  prometheusReachable: boolean | null;
  pageTimings: readonly PageTiming[];
  recentEvents: readonly TelemetryEvent[];
}

async function probe(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal, mode: 'no-cors' });
    clearTimeout(timer);
    return response.type === 'opaque' || response.ok;
  } catch {
    return false;
  }
}

export async function fetchHealthSnapshot(
  indexerEndpoint = 'http://localhost:8787',
): Promise<HealthSnapshot> {
  let indexerHealthy: boolean | null = null;
  let indexerLagLedgers: number | null = null;
  let indexerNextLedger: number | null = null;

  try {
    const response = await fetch(`${indexerEndpoint}/health`);
    if (response.ok) {
      const body = (await response.json()) as {
        ok: boolean;
        nextLedger: number | null;
        lagLedgers?: number;
      };
      indexerHealthy = body.ok;
      indexerNextLedger = body.nextLedger;
      indexerLagLedgers = body.lagLedgers ?? (body.nextLedger != null ? 0 : null);
      recordEvent('indexer.health', { ok: body.ok, nextLedger: body.nextLedger ?? 0 });
    }
  } catch {
    indexerHealthy = false;
    recordEvent('indexer.health', { ok: false });
  }

  const [otelCollectorReachable, prometheusReachable] = await Promise.all([
    probe('http://localhost:4318/v1/traces'),
    probe('http://localhost:9090/-/healthy'),
  ]);

  return {
    sdkTelemetryEnabled: false,
    indexerEndpoint,
    indexerHealthy,
    indexerLagLedgers,
    indexerNextLedger,
    otelCollectorReachable,
    prometheusReachable,
    pageTimings: getPageTimings(),
    recentEvents: getTelemetryEvents().slice(-10),
  };
}

export function formatLagStatus(lag: number | null): string {
  if (lag === null) return '—';
  if (lag <= 2) return 'Synced';
  if (lag <= 10) return 'Catching up';
  return 'Behind';
}

export function averagePageLoadMs(timings: readonly PageTiming[]): number | null {
  if (!timings.length) return null;
  const sum = timings.reduce((acc, t) => acc + t.loadMs, 0);
  return Math.round(sum / timings.length);
}
