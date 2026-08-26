import { useEffect, useState } from 'react';
import { Activity, Gauge, Radio, Server, Timer, Waves } from 'lucide-react';
import {
  averagePageLoadMs,
  fetchHealthSnapshot,
  formatLagStatus,
  recordPageTiming,
  type HealthSnapshot,
} from '../lib/telemetry.js';
import { Card } from '../components/ui/index.js';

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="inline-block w-2 h-2 rounded-full bg-sa-text-dim/40" />;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`}
      aria-hidden
    />
  );
}

export function HealthPage() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  useEffect(() => {
    recordPageTiming('/health');
    const refresh = () =>
      fetchHealthSnapshot().then((snapshot) => {
        setHealth(snapshot);
        setLastRefresh(Date.now());
      });
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, []);

  const avgLoad = health ? averagePageLoadMs(health.pageTimings) : null;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-sa-text">System Health</h1>
          <p className="text-sa-text-dim text-sm mt-1">
            SDK and indexer telemetry · OpenTelemetry semantic conventions v1.0.0
          </p>
        </div>
        <p className="text-xs text-sa-text-dim font-mono">
          Refreshed {new Date(lastRefresh).toLocaleTimeString()}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-2">
            <Activity size={14} />
            SDK Telemetry
          </div>
          <p className="text-lg font-semibold text-sa-text">
            {health?.sdkTelemetryEnabled ? 'Enabled' : 'Disabled (zero overhead)'}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-2">
            <Server size={14} />
            Indexer
            <StatusDot ok={health?.indexerHealthy ?? null} />
          </div>
          <p className="text-lg font-semibold text-sa-text">
            {health === null
              ? 'Checking…'
              : health.indexerHealthy
                ? 'Healthy'
                : 'Unreachable'}
          </p>
          <p className="text-xs text-sa-text-dim mt-1 font-mono truncate">
            {health?.indexerEndpoint}
          </p>
          {health?.indexerNextLedger != null && (
            <p className="text-xs text-sa-text-dim mt-1">Next ledger: {health.indexerNextLedger}</p>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-2">
            <Gauge size={14} />
            Indexer Lag
          </div>
          <p className="text-lg font-semibold text-sa-text">
            {health?.indexerLagLedgers ?? '—'} ledgers
          </p>
          <p className="text-xs text-sa-text-dim mt-1">
            {formatLagStatus(health?.indexerLagLedgers ?? null)}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-2">
            <Timer size={14} />
            Page Load
          </div>
          <p className="text-lg font-semibold text-sa-text">
            {avgLoad ?? '—'} ms avg
          </p>
          <p className="text-xs text-sa-text-dim mt-1">
            {health?.pageTimings.length ?? 0} samples
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-3">
            <Waves size={14} />
            Observability stack
          </div>
          <ul className="text-sm space-y-2">
            <li className="flex items-center gap-2">
              <StatusDot ok={health?.otelCollectorReachable ?? null} />
              <span className="text-sa-text-dim">OTel Collector</span>
              <span className="font-mono text-xs ml-auto">:4318</span>
            </li>
            <li className="flex items-center gap-2">
              <StatusDot ok={health?.prometheusReachable ?? null} />
              <span className="text-sa-text-dim">Prometheus</span>
              <span className="font-mono text-xs ml-auto">:9090</span>
            </li>
            <li className="flex items-center gap-2">
              <StatusDot ok={null} />
              <span className="text-sa-text-dim">Grafana</span>
              <span className="font-mono text-xs ml-auto">:3001</span>
            </li>
          </ul>
          <p className="text-xs text-sa-text-dim mt-3">
            Run <code className="text-sa-accent">cd observability && docker compose up</code> then{' '}
            <code className="text-sa-accent">./scripts/verify-stack.sh</code>
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sa-text-dim text-xs mb-3">
            <Radio size={14} />
            Recent dashboard events
          </div>
          {health?.recentEvents.length ? (
            <ul className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
              {health.recentEvents.map((evt, i) => (
                <li key={`${evt.timestamp}-${i}`} className="text-sa-text-dim truncate">
                  {evt.name}{' '}
                  {Object.keys(evt.attributes).length
                    ? JSON.stringify(evt.attributes)
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sa-text-dim">No events recorded yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
