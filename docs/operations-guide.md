# StellarAgent Operations Guide

This guide maps observability dashboards and alerts to the questions operators
ask when running agent payment fleets.

## Local stack

```bash
cd observability
docker compose up
```

| Service | URL | Purpose |
| --- | --- | --- |
| Grafana | http://localhost:3001 | Prebuilt dashboards |
| Prometheus | http://localhost:9090 | Metrics and alert rules |
| OTel Collector | http://localhost:4318 | OTLP HTTP ingest |

Point the SDK at the collector:

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

Enable indexer telemetry:

```typescript
const indexer = new SorobanEventIndexer({
  store,
  contracts,
  startLedger: 1,
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  telemetry: true,
});
```

When telemetry is disabled (the default), there is no runtime overhead and no
OpenTelemetry packages are required.

## Dashboard: Payments & Indexer

### "Why did this agent's payment take nine seconds?"

Open the **Payment latency (p50 / p95)** panel. Drill into
`stellaragent.contract.invoke` traces and compare child span durations:

- Long `simulate` → RPC or contract complexity
- Long `confirm` → network congestion or ledger close delay
- Long gap between `submit` and `confirm` → polling / finality

### "How much has this fleet spent this hour?"

Use indexed events via the indexer query API (`/channels/:id/spend`) for
authoritative on-chain spend. The SDK metrics surface latency and failure
rates; spend totals come from indexed `PaymentChannel` events.

### "Are payments failing, and why?"

**Payment failures by error code** breaks down `stellaragent.payment.failures`
by `stellaragent.error.code`. Common codes:

| Code | Meaning |
| --- | --- |
| `SPEND_LIMIT_EXCEEDED` | Channel period limit hit |
| `RATE_LIMIT_NOT_FOUND` | No rate limiter configured |
| `SIMULATION_FAILED` | Contract rejected the call |
| `TRANSACTION_TIMEOUT` | Submitted but not confirmed in time |

### "Is the indexer keeping up?"

**Indexer lag (ledgers)** shows how far behind the indexer is. The
`IndexerLagHigh` alert fires above 50 ledgers for 5 minutes.

**Decode failures** counts events the indexer could not parse — usually a
contract upgrade or schema mismatch.

## Redaction guarantee

The SDK logger and exporters run all output through redaction filters. Secret
keys (`S…`), auth entry XDR, and PEM blocks are replaced with `[REDACTED]`.
Run `pnpm --filter @stellaragent/core test` — the redaction test proves no
secret reaches an exporter.

## Semantic conventions

Attribute names are versioned in [telemetry-conventions.md](./telemetry-conventions.md).
Do not rename without bumping `stellaragent.semconv.version`.
