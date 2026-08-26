# Observability stack for StellarAgent

Local OpenTelemetry collector, Prometheus, and Grafana with prebuilt dashboards for SDK payments and indexer ingest.

## Quick start

```bash
cd observability
docker compose up -d
./scripts/verify-stack.sh
```

| Service | URL | Purpose |
| --- | --- | --- |
| Grafana | http://localhost:3001 | Dashboards and alerts |
| Prometheus | http://localhost:9090 | Metric storage and queries |
| OTel Collector (HTTP) | http://localhost:4318 | Trace and metric ingestion |

Default Grafana login is `admin` / `admin` (change on first login in production).

## Enable telemetry in your app

### TypeScript SDK

```typescript
const agent = await StellarAgent.create({
  network: 'testnet',
  secretKey: process.env.AGENT_SECRET,
  telemetry: {
    enabled: true,
    otlpEndpoint: 'http://localhost:4318',
    serviceName: 'my-agent',
  },
});
```

When `enabled` is false (default), the SDK uses noop tracer/metrics with zero overhead.

### Indexer

```typescript
import { createIndexerTelemetryAsync } from '@stellaragent/indexer';

const telemetry = await createIndexerTelemetryAsync({
  enabled: true,
  otlpEndpoint: 'http://localhost:4318',
  serviceName: 'stellaragent-indexer',
});

new SorobanEventIndexer({
  // ...
  telemetry: { otlpEndpoint: 'http://localhost:4318' },
});
```

Without OTLP packages installed, the indexer falls back to in-memory telemetry (suitable for unit tests).

## Trace correlation

The SDK registers `payment_id` → transaction hash mappings in-process. When the indexer decodes a payment event, it looks up the same `payment_id` and attaches it to decode spans. For multi-process deployments, both services should export to the same OTLP backend so traces can be joined by `transaction.hash` and `trace.payment_id`.

## Dashboards

Pre-provisioned dashboards live in `grafana/dashboards/`:

- **StellarAgent Overview** — payment latency, failure rate, indexer lag, decode failures

Alerts in `alerts.yml` fire on sustained indexer lag and elevated payment failure rates.

## Verification script

`scripts/verify-stack.sh` checks:

1. Docker Compose services are running
2. OTel collector health endpoint responds
3. Prometheus targets are up
4. Grafana provisioning loaded

Run after `docker compose up` in CI or local dev to confirm the stack is ready.

## Troubleshooting

See [docs/telemetry-troubleshooting.md](../docs/telemetry-troubleshooting.md) for common issues (missing OTel packages, payment_id not appearing on spans, high lag).

See [docs/operations-guide.md](../docs/operations-guide.md) for the operational questions each dashboard answers.
