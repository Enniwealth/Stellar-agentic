# Telemetry troubleshooting

This guide covers common issues when enabling StellarAgent observability (issue #391).

## Telemetry appears disabled

**Symptom:** No spans or metrics in Grafana; dashboard shows "Disabled (zero overhead)".

**Cause:** Telemetry is opt-in. Default SDK and indexer behaviour uses noop implementations with zero overhead.

**Fix:**

```typescript
const agent = await StellarAgent.create({
  network: 'testnet',
  secretKey: process.env.AGENT_SECRET,
  telemetry: {
    enabled: true,
    otlpEndpoint: 'http://localhost:4318',
  },
});
```

For the indexer:

```typescript
new SorobanEventIndexer({
  // ...
  telemetry: { otlpEndpoint: 'http://localhost:4318', serviceName: 'stellaragent-indexer' },
});
```

Call `createIndexerTelemetryAsync()` at startup when OTLP export is required.

## OpenTelemetry packages not installed

**Symptom:** Log message: `OpenTelemetry packages not installed; telemetry export disabled`.

**Fix:** Install optional peer dependencies:

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/sdk-metrics @opentelemetry/resources @opentelemetry/semantic-conventions
```

In-memory telemetry (`InMemoryTracer`, `InMemoryMetrics`) works without these packages for unit tests.

## payment_id missing on indexer spans

**Symptom:** Indexer decode spans have `transaction.hash` but not `trace.payment_id`.

**Cause:** The SDK registers payment traces in-process. The indexer looks up `payment_id` by transaction hash via `lookupPaymentIdByTxHash`. If the SDK and indexer run in separate processes without a shared registry, correlation is best-effort unless both export to the same OTLP backend with trace context propagation.

**Fix for single-process dev:** Run SDK payment and indexer in the same Node process, or verify traces in OTLP where both services attach the same `payment_id` attribute.

## High indexer lag

**Symptom:** `indexer.lag_ledgers` metric or dashboard lag card shows large values.

**Checks:**

1. RPC endpoint latency — Soroban `getEvents` pagination may be slow on public RPC.
2. `finalityLag` and `rollbackWindow` settings in indexer options.
3. Decode failures — check `indexer.decode_failures` counter; malformed events do not advance correlation.

## Local stack not reachable

**Symptom:** Grafana/Prometheus URLs fail to load.

**Fix:**

```bash
cd observability
docker compose up -d
./scripts/verify-stack.sh
```

Expected endpoints:

- Grafana: http://localhost:3001
- Prometheus: http://localhost:9090
- OTel Collector HTTP: http://localhost:4318

## Redaction

Structured logs pass through `RedactingLogger`. Fields matching `secret`, `seed`, `mnemonic`, or Stellar secret key patterns are replaced with `[REDACTED]`. If custom log sinks still capture sensitive data, audit your sink configuration.

## Semantic conventions

All attribute and metric names are documented in [telemetry-conventions.md](./telemetry-conventions.md). Version `1.0.0` is reported on every span via `stellaragent.semconv.version`.
