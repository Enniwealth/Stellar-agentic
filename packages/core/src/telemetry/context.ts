import { randomUUID } from 'node:crypto';

/** In-process registry linking submitted tx hashes to SDK payment trace IDs. */
export interface PaymentTraceRecord {
  paymentId: string;
  agentAddress: string;
  method: string;
  amount?: string;
  endpoint?: string;
  submittedAt: number;
  transactionHash?: string;
}

const byPaymentId = new Map<string, PaymentTraceRecord>();
const byTxHash = new Map<string, string>();

export function createPaymentId(): string {
  return randomUUID();
}

export function registerPaymentTrace(record: PaymentTraceRecord): void {
  byPaymentId.set(record.paymentId, record);
  if (record.transactionHash) {
    byTxHash.set(record.transactionHash, record.paymentId);
  }
}

export function attachTransactionHash(paymentId: string, transactionHash: string): void {
  const existing = byPaymentId.get(paymentId);
  if (!existing) return;
  existing.transactionHash = transactionHash;
  byTxHash.set(transactionHash, paymentId);
}

export function lookupPaymentIdByTxHash(txHash: string): string | undefined {
  return byTxHash.get(txHash);
}

export function getPaymentTrace(paymentId: string): PaymentTraceRecord | undefined {
  return byPaymentId.get(paymentId);
}

/** Test helper — clears registries between tests. */
export function clearPaymentTraceRegistry(): void {
  byPaymentId.clear();
  byTxHash.clear();
}

export function activePaymentTraceCount(): number {
  return byPaymentId.size;
}
