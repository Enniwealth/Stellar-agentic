import type { Tracer, Metrics, Logger } from "@stellaragent/core";
import {
  SpanNames,
  SemConv,
  MetricNames,
  noopTracer,
  noopMetrics,
  noopLogger,
  InMemoryTracer,
  InMemoryMetrics,
  RedactingLogger,
  lookupPaymentIdByTxHash,
} from "@stellaragent/core";
import type { IndexResult } from "./indexer.js";
import type { DecodedEvent } from "./types.js";

export interface IndexerTelemetryOptions {
  enabled?: boolean;
  otlpEndpoint?: string;
  serviceName?: string;
}

export interface IndexerTelemetry {
  enabled: boolean;
  tracer: Tracer;
  metrics: Metrics;
  logger: Logger;
}

export interface InstrumentedIndexResult extends IndexResult {
  decodeFailures: number;
  lagLedgers: number;
}

export function createIndexerTelemetry(options: IndexerTelemetryOptions = {}): IndexerTelemetry {
  if (!options.enabled) {
    return {
      enabled: false,
      tracer: noopTracer,
      metrics: noopMetrics,
      logger: noopLogger,
    };
  }

  return {
    enabled: true,
    tracer: new InMemoryTracer(),
    metrics: new InMemoryMetrics(),
    logger: new RedactingLogger({ minLevel: "debug" }),
  };
}

/** Async factory when OTLP export is configured — call at indexer startup. */
export async function createIndexerTelemetryAsync(
  options: IndexerTelemetryOptions,
): Promise<IndexerTelemetry> {
  if (!options.enabled) {
    return createIndexerTelemetry({ enabled: false });
  }

  if (options.otlpEndpoint) {
    try {
      const { createOtelBridge } = await import("@stellaragent/core");
      const bridge = await createOtelBridge({
        serviceName: options.serviceName ?? "stellaragent-indexer",
        otlpEndpoint: options.otlpEndpoint,
      });
      return {
        enabled: true,
        tracer: bridge.tracer,
        metrics: bridge.metrics,
        logger: new RedactingLogger({ minLevel: "debug" }),
      };
    } catch (error) {
      noopLogger.warn("OTLP bridge unavailable, falling back to in-memory telemetry", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    enabled: true,
    tracer: new InMemoryTracer(),
    metrics: new InMemoryMetrics(),
    logger: new RedactingLogger({ minLevel: "debug" }),
  };
}

export function instrumentDecodedEvent(
  telemetry: IndexerTelemetry,
  event: DecodedEvent,
): DecodedEvent {
  if (!telemetry.enabled) return event;

  telemetry.tracer.startActiveSpan(SpanNames.indexerDecode, {}, (span) => {
    const paymentId = lookupPaymentIdByTxHash(event.txHash);
    span.setAttribute(SemConv.indexer.eventCount, 1);
    span.setAttribute(SemConv.transaction.hash, event.txHash);
    if (paymentId) {
      span.setAttribute(SemConv.trace.paymentId, paymentId);
    }
    if (event.namespace === "channel" && event.action === "paid") {
      span.setAttribute(SemConv.channel.id, event.channelId);
      span.setAttribute(SemConv.payment.amount, event.amount);
    }
  });
  return event;
}

export async function instrumentIndexRun(
  telemetry: IndexerTelemetry,
  run: () => Promise<IndexResult & { decodeFailures?: number; latestLedger?: number }>,
): Promise<InstrumentedIndexResult> {
  if (!telemetry.enabled) {
    const result = await run();
    const lagLedgers = Math.max(0, (result.latestLedger ?? result.throughLedger) - result.throughLedger);
    return {
      fromLedger: result.fromLedger,
      throughLedger: result.throughLedger,
      eventCount: result.eventCount,
      decodeFailures: result.decodeFailures ?? 0,
      lagLedgers,
    };
  }

  const start = Date.now();
  return telemetry.tracer.startActiveSpan(SpanNames.indexerRun, {}, async () => {
    const result = await run();
    const lagLedgers = Math.max(0, (result.latestLedger ?? result.throughLedger) - result.throughLedger);
    const decodeFailures = result.decodeFailures ?? 0;

    telemetry.metrics.recordHistogram(
      MetricNames.indexerThroughputEvents,
      result.eventCount,
      { [SemConv.indexer.eventCount]: result.eventCount },
    );
    telemetry.metrics.recordHistogram(MetricNames.indexerLagLedgers, lagLedgers);
    if (decodeFailures > 0) {
      telemetry.metrics.incrementCounter(MetricNames.indexerDecodeFailures, decodeFailures);
    }

    telemetry.logger.debug("indexer run complete", {
      fromLedger: result.fromLedger,
      throughLedger: result.throughLedger,
      eventCount: result.eventCount,
      decodeFailures,
      lagLedgers,
      durationMs: Date.now() - start,
    });

    return {
      fromLedger: result.fromLedger,
      throughLedger: result.throughLedger,
      eventCount: result.eventCount,
      decodeFailures,
      lagLedgers,
    };
  });
}
