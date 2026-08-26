import type { Network } from '../types/index.js';
import { RedactingLogger, noopLogger, type Logger, type LogRecord } from './logger.js';
import { InMemoryMetrics, noopMetrics, type Metrics } from './metrics.js';
import { InMemoryTracer, noopTracer, type Tracer } from './tracer.js';
import { SEMCONV_VERSION, SemConv } from './semantic.js';

export interface TelemetryConfig {
  /** When false (default), all telemetry is no-op with zero overhead. */
  enabled?: boolean;
  /** Service name reported to exporters. */
  serviceName?: string;
  /** OTLP endpoint for traces and metrics (e.g. http://localhost:4318). */
  otlpEndpoint?: string;
  /** Custom logger sink — receives redacted records only. */
  logSink?: (record: LogRecord) => void;
  /** Minimum log level when a custom sink is configured. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Inject tracers/metrics for tests. */
  tracer?: Tracer;
  metrics?: Metrics;
  logger?: Logger;
}

export interface TelemetryContext {
  enabled: boolean;
  tracer: Tracer;
  metrics: Metrics;
  logger: Logger;
  network?: Network;
  agentAddress?: string;
}

let globalTelemetry: TelemetryContext = {
  enabled: false,
  tracer: noopTracer,
  metrics: noopMetrics,
  logger: noopLogger,
};

export function getTelemetry(): TelemetryContext {
  return globalTelemetry;
}

export function createTelemetry(config: TelemetryConfig = {}): TelemetryContext {
  if (config.enabled !== true) {
    return {
      enabled: false,
      tracer: noopTracer,
      metrics: noopMetrics,
      logger: noopLogger,
    };
  }

  return {
    enabled: true,
    tracer: config.tracer ?? noopTracer,
    metrics: config.metrics ?? noopMetrics,
    logger:
      config.logger ??
      (config.logSink
        ? new RedactingLogger({ sink: config.logSink, minLevel: config.logLevel })
        : new RedactingLogger()),
  };
}

/**
 * Initialize global telemetry. When `enabled` is false, this is a no-op and
 * OpenTelemetry packages are never loaded.
 */
export async function initTelemetry(
  config: TelemetryConfig & { network?: Network; agentAddress?: string } = {},
): Promise<TelemetryContext> {
  const ctx = createTelemetry(config);

  if (config.enabled === true && config.otlpEndpoint && !config.tracer) {
    try {
      const otel = await import('./otel-bridge.js');
      const bridged = await otel.createOtelBridge({
        serviceName: config.serviceName ?? 'stellaragent-sdk',
        otlpEndpoint: config.otlpEndpoint,
      });
      ctx.tracer = bridged.tracer;
      ctx.metrics = bridged.metrics;
    } catch {
      ctx.logger.warn('OpenTelemetry packages not installed; telemetry export disabled');
    }
  }

  ctx.network = config.network;
  ctx.agentAddress = config.agentAddress;
  globalTelemetry = ctx;
  return ctx;
}

export function baseAttributes(ctx: TelemetryContext): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    [SemConv.version]: SEMCONV_VERSION,
  };
  if (ctx.network) attrs[SemConv.network] = ctx.network;
  if (ctx.agentAddress) attrs[SemConv.agent.address] = ctx.agentAddress;
  return attrs;
}

export { noopLogger, noopTracer, noopMetrics, RedactingLogger, InMemoryTracer, InMemoryMetrics };
export { redactForExport } from './logger.js';
export { createOtelBridge } from './otel-bridge.js';
export type { OtelBridgeOptions } from './otel-bridge.js';
export * from './semantic.js';
export {
  createPaymentId,
  registerPaymentTrace,
  attachTransactionHash,
  lookupPaymentIdByTxHash,
  getPaymentTrace,
  clearPaymentTraceRegistry,
  activePaymentTraceCount,
} from './context.js';
export type { PaymentTraceRecord } from './context.js';
export type { Logger, LogRecord } from './logger.js';
export type { Tracer, Span, RecordedSpan } from './tracer.js';
export type { Metrics, HistogramRecord, CounterRecord } from './metrics.js';
