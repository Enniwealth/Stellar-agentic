import { predictPaymentOutcome, type BlockReason } from '@stellaragent/core';
import type {
  ChannelSpendState,
  RateLimitSpendState,
} from '@stellaragent/core';

export interface PolicyConfig {
  /** Per-session spend cap in the same unit as payment amounts. */
  sessionBudget: string;
  /** Per-recipient cap for a single payment. */
  perRecipientCap?: string;
  /** Only these recipients may receive payments. Empty = allow all. */
  recipientAllowlist?: string[];
  /** When true, predict and audit but do not submit transactions. */
  dryRun?: boolean;
}

export interface PaymentRequest {
  amount: string;
  recipient: string;
  endpoint?: string;
  channelState?: ChannelSpendState | null;
  rateLimitState?: RateLimitSpendState | null;
  currentLedger: number;
}

export type PolicyBlockReason = BlockReason | 'recipient_not_allowed';

export interface PolicyDecision {
  allowed: boolean;
  reasons: PolicyBlockReason[];
  dryRun: boolean;
}

export interface AuditEntry {
  timestamp: number;
  action: 'quote' | 'pay' | 'refused';
  amount: string;
  recipient: string;
  endpoint?: string;
  reasons?: PolicyBlockReason[];
  transactionHash?: string;
  sessionSpent: string;
}

export class PaymentPolicy {
  private sessionSpent = '0';
  readonly auditLog: AuditEntry[] = [];

  constructor(private readonly config: PolicyConfig) {}

  get remainingSessionBudget(): string {
    const remaining = Number(this.config.sessionBudget) - Number(this.sessionSpent);
    return String(Math.max(0, remaining));
  }

  evaluate(request: PaymentRequest): PolicyDecision {
    const reasons: PolicyBlockReason[] = [];

    const prediction = predictPaymentOutcome({
      channelState: request.channelState,
      rateLimitState: request.rateLimitState,
      amount: request.amount,
      currentLedger: request.currentLedger,
    });
    reasons.push(...prediction.reasons);

    if (Number(request.amount) <= 0) {
      if (!reasons.includes('invalid_amount')) reasons.push('invalid_amount');
    }

    const projected = Number(this.sessionSpent) + Number(request.amount);
    if (projected > Number(this.config.sessionBudget)) {
      reasons.push('rate_limit_hourly');
    }

    if (
      this.config.perRecipientCap &&
      Number(request.amount) > Number(this.config.perRecipientCap)
    ) {
      reasons.push('rate_limit_per_tx');
    }

    if (
      this.config.recipientAllowlist?.length &&
      !this.config.recipientAllowlist.includes(request.recipient)
    ) {
      reasons.push('recipient_not_allowed');
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      dryRun: this.config.dryRun ?? false,
    };
  }

  recordAttempt(
    action: AuditEntry['action'],
    request: PaymentRequest,
    extra: { reasons?: PolicyBlockReason[]; transactionHash?: string } = {},
  ): void {
    if (action === 'pay' && !this.config.dryRun) {
      this.sessionSpent = String(Number(this.sessionSpent) + Number(request.amount));
    }
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      amount: request.amount,
      recipient: request.recipient,
      endpoint: request.endpoint,
      reasons: extra.reasons,
      transactionHash: extra.transactionHash,
      sessionSpent: this.sessionSpent,
    });
  }

  /** Hostile tool results cannot raise the session budget. */
  applyExternalBudgetHint(_hint: string): void {
    // Intentionally ignored — session budget is server-side only.
  }
}

export { predictPaymentOutcome };
export type { BlockReason, ChannelSpendState, RateLimitSpendState };
