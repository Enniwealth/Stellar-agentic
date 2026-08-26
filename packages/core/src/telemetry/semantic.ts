/**
 * StellarAgent semantic conventions for OpenTelemetry spans and metrics.
 *
 * @version 1.0.0 — stable; dashboards and alerts depend on these names.
 * @see docs/telemetry-conventions.md
 */

export const SEMCONV_VERSION = '1.0.0';

/** Namespace prefix for all StellarAgent telemetry attributes. */
export const SA = 'stellaragent' as const;

export const SemConv = {
  version: `${SA}.semconv.version`,
  agent: {
    id: `${SA}.agent.id`,
    address: `${SA}.agent.address`,
    name: `${SA}.agent.name`,
  },
  channel: {
    id: `${SA}.channel.id`,
  },
  job: {
    id: `${SA}.job.id`,
    status: `${SA}.job.status`,
  },
  contract: {
    id: `${SA}.contract.id`,
    method: `${SA}.contract.method`,
    kind: `${SA}.contract.kind`,
  },
  network: `${SA}.network`,
  payment: {
    amount: `${SA}.payment.amount`,
    asset: `${SA}.payment.asset`,
    endpoint: `${SA}.payment.endpoint`,
    recipient: `${SA}.payment.recipient`,
  },
  transaction: {
    hash: `${SA}.transaction.hash`,
    ledger: `${SA}.transaction.ledger`,
  },
  error: {
    code: `${SA}.error.code`,
  },
  indexer: {
    fromLedger: `${SA}.indexer.from_ledger`,
    throughLedger: `${SA}.indexer.through_ledger`,
    eventCount: `${SA}.indexer.event_count`,
    lagLedgers: `${SA}.indexer.lag_ledgers`,
    decodeFailures: `${SA}.indexer.decode_failures`,
  },
  trace: {
    paymentId: `${SA}.trace.payment_id`,
  },
} as const;

/** Span names for the SDK invocation lifecycle. */
export const SpanNames = {
  contractInvoke: `${SA}.contract.invoke`,
  simulate: `${SA}.contract.simulate`,
  sign: `${SA}.contract.sign`,
  submit: `${SA}.contract.submit`,
  confirm: `${SA}.contract.confirm`,
  payForApi: `${SA}.payment.pay_for_api`,
  indexerRun: `${SA}.indexer.run`,
  indexerDecode: `${SA}.indexer.decode`,
} as const;

/** Metric names exported by the SDK and indexer. */
export const MetricNames = {
  paymentLatencyMs: `${SA}.payment.latency_ms`,
  paymentFailures: `${SA}.payment.failures`,
  paymentFeesStroops: `${SA}.payment.fees_stroops`,
  indexerLagLedgers: `${SA}.indexer.lag_ledgers`,
  indexerThroughputEvents: `${SA}.indexer.throughput_events`,
  indexerDecodeFailures: `${SA}.indexer.decode_failures`,
} as const;

export type SemanticAttributes = Record<string, string | number | boolean>;
