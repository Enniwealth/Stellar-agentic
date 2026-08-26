import { describe, it, expect, beforeEach } from "vitest";
import {
  registerPaymentTrace,
  clearPaymentTraceRegistry,
  InMemoryTracer,
  InMemoryMetrics,
  SpanNames,
  SemConv,
} from "@stellaragent/core";
import { createIndexerTelemetry, instrumentDecodedEvent, instrumentIndexRun } from "../telemetry.js";
import type { DecodedEvent } from "../types.js";

function paidEvent(txHash: string): DecodedEvent {
  return {
    eventId: "evt-1",
    contractKind: "paymentChannel",
    contractAddress: "CCHANNEL",
    ledger: 200,
    ledgerClosedAt: "",
    txHash,
    pagingToken: "p1",
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
}

describe("SDK → indexer trace correlation", () => {
  beforeEach(() => {
    clearPaymentTraceRegistry();
  });

  it("propagates payment_id from SDK registry into indexer decode spans", () => {
    registerPaymentTrace({
      paymentId: "pay-correlation-001",
      agentAddress: "GAGENT",
      method: "pay_for_api",
      amount: "0.01",
      submittedAt: Date.now(),
      transactionHash: "sdk-submitted-hash",
    });

    const telemetry = createIndexerTelemetry({ enabled: true });
    instrumentDecodedEvent(telemetry, paidEvent("sdk-submitted-hash"));

    const spans = (telemetry.tracer as InMemoryTracer).spans;
    const decodeSpan = spans.find((s) => s.name === SpanNames.indexerDecode);
    expect(decodeSpan?.attributes[SemConv.trace.paymentId]).toBe("pay-correlation-001");
    expect(decodeSpan?.attributes[SemConv.transaction.hash]).toBe("sdk-submitted-hash");
    expect(decodeSpan?.attributes[SemConv.channel.id]).toBe("1");
  });

  it("indexes multiple events in one run with independent correlation", async () => {
    registerPaymentTrace({
      paymentId: "pay-a",
      agentAddress: "GAGENT",
      method: "pay",
      submittedAt: Date.now(),
      transactionHash: "tx-a",
    });
    registerPaymentTrace({
      paymentId: "pay-b",
      agentAddress: "GAGENT",
      method: "pay",
      submittedAt: Date.now(),
      transactionHash: "tx-b",
    });

    const telemetry = createIndexerTelemetry({ enabled: true });
    instrumentDecodedEvent(telemetry, paidEvent("tx-a"));
    instrumentDecodedEvent(telemetry, paidEvent("tx-b"));

    const spans = (telemetry.tracer as InMemoryTracer).spans;
    const ids = spans
      .filter((s) => s.name === SpanNames.indexerDecode)
      .map((s) => s.attributes[SemConv.trace.paymentId]);
    expect(ids).toContain("pay-a");
    expect(ids).toContain("pay-b");
  });

  it("records lag metrics on instrumented catch-up runs", async () => {
    const telemetry = createIndexerTelemetry({ enabled: true });
    const result = await instrumentIndexRun(telemetry, async () => ({
      fromLedger: 10,
      throughLedger: 500,
      eventCount: 128,
      decodeFailures: 0,
      latestLedger: 512,
    }));

    expect(result.lagLedgers).toBe(12);
    expect(result.eventCount).toBe(128);
    const metrics = telemetry.metrics as InMemoryMetrics;
    expect(metrics.histograms.some((h) => h.name.includes("lag"))).toBe(true);
    expect(metrics.histograms.some((h) => h.name.includes("throughput"))).toBe(true);
  });
});
