# StellarAgent Telemetry Semantic Conventions

**Version:** 1.0.0 (`stellaragent.semconv.version`)

Stable attribute and metric names for OpenTelemetry spans, metrics, and
dashboards. Do not rename without bumping the version — Grafana panels and
alert rules depend on these strings.

## Span names

| Span | Description |
| --- | --- |
| `stellaragent.contract.invoke` | Root span for every Soroban contract call |
| `stellaragent.contract.simulate` | RPC simulation |
| `stellaragent.contract.sign` | Auth entry and envelope signing |
| `stellaragent.contract.submit` | Transaction submission |
| `stellaragent.contract.confirm` | Poll until terminal status |
| `stellaragent.payment.pay_for_api` | High-level payment operation |
| `stellaragent.indexer.run` | One indexer catch-up cycle |
| `stellaragent.indexer.decode` | Single event decode |

## Attributes

| Attribute | Example | Description |
| --- | --- | --- |
| `stellaragent.agent.address` | `GABC…` | Agent public key |
| `stellaragent.agent.id` | `7` | On-chain agent wallet ID |
| `stellaragent.channel.id` | `3` | Payment channel ID |
| `stellaragent.job.id` | `12` | Escrow job ID |
| `stellaragent.contract.id` | `CABC…` | Soroban contract address |
| `stellaragent.contract.method` | `pay` | Contract method name |
| `stellaragent.network` | `testnet` | Stellar network |
| `stellaragent.payment.amount` | `0.001` | Human-readable amount |
| `stellaragent.payment.asset` | `USDC` | Asset code |
| `stellaragent.transaction.hash` | `abc123…` | Submitted transaction hash |
| `stellaragent.error.code` | `SPEND_LIMIT_EXCEEDED` | Stable SDK error code |

## Metrics

| Metric | Type | Description |
| --- | --- | --- |
| `stellaragent.payment.latency_ms` | histogram | End-to-end payment latency |
| `stellaragent.payment.failures` | counter | Failures tagged by error code |
| `stellaragent.indexer.lag_ledgers` | histogram | Indexer lag in ledgers |
| `stellaragent.indexer.throughput_events` | histogram | Events indexed per run |

## Trace correlation

Set `stellaragent.trace.payment_id` on SDK spans and propagate the same value
to indexer spans when decoding the resulting on-chain event, so a payment trace
links simulation through confirmation to the indexed audit event.
