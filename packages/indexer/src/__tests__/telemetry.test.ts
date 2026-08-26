import { describe, it, expect } from "vitest";
import {
  registerPaymentTrace,
  lookupPaymentIdByTxHash,
  clearPaymentTraceRegistry,
  InMemoryTracer,
  InMemoryMetrics,
  SpanNames,
  SemConv,
} from "@stellaragent/core";
import {
  createIndexerTelemetry,
  createIndexerTelemetryAsync,
  instrumentDecodedEvent,
  instrumentIndexRun,
} from "../telemetry.js";
import type { DecodedEvent } from "../types.js";

describe("indexer telemetry", () => {
  it("uses real InMemory tracer when enabled", () => {
    const telemetry = createIndexerTelemetry({ enabled: true });
    expect(telemetry.enabled).toBe(true);
    telemetry.tracer.startActiveSpan("test", {}, (span) => span.end());
    expect((telemetry.tracer as InMemoryTracer).spans.length).toBeGreaterThan(0);
  });

  it("correlates decoded payment events with SDK payment_id via tx hash", () => {
    clearPaymentTraceRegistry();
    registerPaymentTrace({
      paymentId: "pay-abc-123",
      agentAddress: "GTEST",
      method: "pay",
      submittedAt: Date.now(),
      transactionHash: "indexed-tx-hash",
    });

    const telemetry = createIndexerTelemetry({ enabled: true });
    const event: DecodedEvent = {
      eventId: "1",
      contractKind: "paymentChannel",
      contractAddress: "CCHANNEL",
      ledger: 50,
      ledgerClosedAt: "",
      txHash: "indexed-tx-hash",
      pagingToken: "p",
      namespace: "channel",
      action: "paid",
      rawTopicXdr: [],
      rawValueXdr: "",
      channelId: "1",
      agent: "GAGENT",
      recipient: "GRECIP",
      amount: "1000000",
      memo: "https://api.example.com",
    };

    instrumentDecodedEvent(telemetry, event);
    const spans = (telemetry.tracer as InMemoryTracer).spans;
    const decodeSpan = spans.find((s) => s.name === SpanNames.indexerDecode);
    expect(decodeSpan?.attributes[SemConv.trace.paymentId]).toBe("pay-abc-123");
    expect(lookupPaymentIdByTxHash("indexed-tx-hash")).toBe("pay-abc-123");
  });

  it("records lag and throughput on instrumented runs", async () => {
    const telemetry = createIndexerTelemetry({ enabled: true });
    const result = await instrumentIndexRun(telemetry, async () => ({
      fromLedger: 1,
      throughLedger: 100,
      eventCount: 42,
      decodeFailures: 2,
      latestLedger: 105,
    }));
    expect(result.lagLedgers).toBe(5);
    expect(result.decodeFailures).toBe(2);
    const metrics = telemetry.metrics as InMemoryMetrics;
    expect(metrics.counters.some((c) => c.name.includes("decode_failures"))).toBe(true);
  });

  it("creates enabled telemetry when OTLP endpoint is configured", async () => {
    const telemetry = await createIndexerTelemetryAsync({
      enabled: true,
      otlpEndpoint: "http://localhost:4318",
    });
    expect(telemetry.enabled).toBe(true);
    expect(typeof telemetry.tracer.startActiveSpan).toBe("function");
    expect(typeof telemetry.metrics.recordHistogram).toBe("function");
  });
});
