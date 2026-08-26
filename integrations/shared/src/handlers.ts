/**
 * Shared tool handler implementations used by MCP, LangChain, and LlamaIndex adapters.
 * Behaviour cannot diverge — every adapter dispatches through this module.
 */
import type { StellarAgent } from '@stellaragent/core';
import {
  createPaymentId,
  registerPaymentTrace,
  attachTransactionHash,
  lookupPaymentIdByTxHash,
} from '@stellaragent/core';
import { PaymentPolicy, type PolicyConfig, type PaymentRequest } from './policy.js';
import { ToolError, toolErrorFromRefusal } from './errors.js';

export interface ToolContext {
  agent: StellarAgent;
  policy: PaymentPolicy;
  currentLedger: number;
}

export interface ToolSuccess {
  ok: true;
  data: Record<string, unknown>;
}

export interface ToolFailure {
  ok: false;
  error: ToolError;
}

export type ToolResponse = ToolSuccess | ToolFailure;

function safeData(data: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(data);
  if (/S[A-Z2-7]{55}/.test(serialized)) {
    throw new ToolError('KEY_MATERIAL_BLOCKED', 'Tool result would expose key material');
  }
  return data;
}

function success(data: Record<string, unknown>): ToolSuccess {
  return { ok: true, data: safeData(data) };
}

function refuse(reasons: import('./policy.js').PolicyBlockReason[]): ToolFailure {
  return { ok: false, error: toolErrorFromRefusal(reasons) };
}

export function createToolContext(
  agent: StellarAgent,
  policyConfig: PolicyConfig,
  currentLedger = 1,
): ToolContext {
  return { agent, policy: new PaymentPolicy(policyConfig), currentLedger };
}

export async function quotePayment(
  ctx: ToolContext,
  input: { amount: string; recipient: string },
): Promise<ToolResponse> {
  const request: PaymentRequest = {
    amount: input.amount,
    recipient: input.recipient,
    currentLedger: ctx.currentLedger,
  };
  const decision = ctx.policy.evaluate(request);
  ctx.policy.recordAttempt(decision.allowed ? 'quote' : 'refused', request, {
    reasons: decision.reasons,
  });
  return success({
    wouldBlock: !decision.allowed,
    reasons: decision.reasons,
    remainingSessionBudget: ctx.policy.remainingSessionBudget,
  });
}

export async function payForApi(
  ctx: ToolContext,
  input: { amount: string; recipient: string; endpoint: string },
): Promise<ToolResponse> {
  const request: PaymentRequest = {
    amount: input.amount,
    recipient: input.recipient,
    endpoint: input.endpoint,
    currentLedger: ctx.currentLedger,
  };
  const decision = ctx.policy.evaluate(request);
  if (!decision.allowed) {
    ctx.policy.recordAttempt('refused', request, { reasons: decision.reasons });
    return refuse(decision.reasons);
  }

  const paymentId = createPaymentId();
  registerPaymentTrace({
    paymentId,
    agentAddress: ctx.agent.address,
    method: 'pay_for_api',
    amount: input.amount,
    endpoint: input.endpoint,
    submittedAt: Date.now(),
  });

  if (decision.dryRun) {
    ctx.policy.recordAttempt('pay', request);
    return success({ dryRun: true, paymentId, amount: input.amount, recipient: input.recipient });
  }

  try {
    const tx = await ctx.agent.payForAPI({
      endpoint: input.endpoint,
      amount: input.amount,
      recipient: input.recipient,
    });
    const linkedId = lookupPaymentIdByTxHash(tx.hash) ?? paymentId;
    attachTransactionHash(linkedId, tx.hash);
    ctx.policy.recordAttempt('pay', request, { transactionHash: tx.hash });
    return success({
      paymentId: linkedId,
      hash: tx.hash,
      success: tx.success,
      ledger: tx.ledger,
    });
  } catch (error) {
    throw new ToolError(
      'SDK_ERROR',
      error instanceof Error ? error.message : String(error),
      { cause: error, retryable: true },
    );
  }
}

export async function getChannelStatus(ctx: ToolContext): Promise<ToolResponse> {
  const report = await ctx.agent.getSpendReport();
  return success({
    spentThisPeriod: report.spentThisPeriod,
    remainingThisPeriod: report.remainingThisPeriod,
    totalLifetime: report.totalLifetime,
  });
}

export async function getRateLimits(ctx: ToolContext): Promise<ToolResponse> {
  const status = await ctx.agent.getRateLimitStatus();
  return success({ ...status });
}

export async function createEscrowJob(
  ctx: ToolContext,
  input: { workerAgent: string; task: string; escrowAmount: string; asset?: string },
): Promise<ToolResponse> {
  const jobId = await ctx.agent.requestWork({
    workerAgent: input.workerAgent,
    task: input.task,
    escrowAmount: input.escrowAmount,
    asset: input.asset,
  });
  return success({ jobId: jobId.toString() });
}

export async function acceptEscrowJob(
  ctx: ToolContext,
  input: { jobId: string },
): Promise<ToolResponse> {
  const tx = await ctx.agent.acceptJob(BigInt(input.jobId));
  return success({ jobId: input.jobId, hash: tx.hash, success: tx.success });
}

export async function submitEscrowResult(
  ctx: ToolContext,
  input: { jobId: string; result: string },
): Promise<ToolResponse> {
  const tx = await ctx.agent.submitResult(BigInt(input.jobId), input.result);
  return success({ jobId: input.jobId, hash: tx.hash, success: tx.success });
}

export async function releaseEscrowPayment(
  ctx: ToolContext,
  input: { jobId: string },
): Promise<ToolResponse> {
  const tx = await ctx.agent.releasePayment(BigInt(input.jobId));
  return success({ jobId: input.jobId, hash: tx.hash, success: tx.success });
}

export async function getEscrowJob(
  ctx: ToolContext,
  input: { jobId: string },
): Promise<ToolResponse> {
  const job = await ctx.agent.getJob(BigInt(input.jobId));
  return success({
    id: job.id.toString(),
    status: job.status,
    requester: job.requester,
    worker: job.worker,
    amount: job.amount.toString(),
    deadlineLedger: job.deadlineLedger,
  });
}

export async function openPaymentChannel(
  ctx: ToolContext,
  input: { deposit: string; limitPerPeriod: string; period: 'hourly' | 'daily' | 'per_ledger'; token?: string },
): Promise<ToolResponse> {
  const channelId = await ctx.agent.openChannel({
    deposit: input.deposit,
    limitPerPeriod: input.limitPerPeriod,
    period: input.period,
    token: input.token,
  });
  return success({ channelId: channelId.toString() });
}

export const TOOL_NAMES = [
  'stellaragent_quote',
  'stellaragent_pay',
  'stellaragent_channel_status',
  'stellaragent_rate_limits',
  'stellaragent_open_channel',
  'stellaragent_create_job',
  'stellaragent_accept_job',
  'stellaragent_submit_job_result',
  'stellaragent_release_job',
  'stellaragent_get_job',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SCHEMAS: Record<ToolName, { description: string; inputSchema: Record<string, unknown> }> = {
  stellaragent_quote: {
    description: 'Predict whether a payment would be blocked before spending',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'string' }, recipient: { type: 'string' } },
      required: ['amount', 'recipient'],
    },
  },
  stellaragent_pay: {
    description: 'Pay for an API call through the agent payment channel',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'string' },
        recipient: { type: 'string' },
        endpoint: { type: 'string' },
      },
      required: ['amount', 'recipient', 'endpoint'],
    },
  },
  stellaragent_channel_status: {
    description: 'Get spend report for the active payment channel',
    inputSchema: { type: 'object', properties: {} },
  },
  stellaragent_rate_limits: {
    description: 'Get on-chain rate limit status for this agent',
    inputSchema: { type: 'object', properties: {} },
  },
  stellaragent_open_channel: {
    description: 'Open a payment channel with deposit and period limit',
    inputSchema: {
      type: 'object',
      properties: {
        deposit: { type: 'string' },
        limitPerPeriod: { type: 'string' },
        period: { type: 'string', enum: ['hourly', 'daily', 'per_ledger'] },
        token: { type: 'string' },
      },
      required: ['deposit', 'limitPerPeriod', 'period'],
    },
  },
  stellaragent_create_job: {
    description: 'Create an escrow job for agent-to-agent work',
    inputSchema: {
      type: 'object',
      properties: {
        workerAgent: { type: 'string' },
        task: { type: 'string' },
        escrowAmount: { type: 'string' },
        asset: { type: 'string' },
      },
      required: ['workerAgent', 'task', 'escrowAmount'],
    },
  },
  stellaragent_accept_job: {
    description: 'Accept an open escrow job as the worker agent',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  stellaragent_submit_job_result: {
    description: 'Submit work result for an escrow job',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' }, result: { type: 'string' } },
      required: ['jobId', 'result'],
    },
  },
  stellaragent_release_job: {
    description: 'Release escrow payment to the worker after work is complete',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
  stellaragent_get_job: {
    description: 'Get escrow job status and metadata',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
};

export async function dispatchToolHandler(
  ctx: ToolContext,
  name: string,
  args: Record<string, string>,
): Promise<ToolResponse> {
  switch (name as ToolName) {
    case 'stellaragent_quote':
      return quotePayment(ctx, args as { amount: string; recipient: string });
    case 'stellaragent_pay':
      return payForApi(ctx, args as { amount: string; recipient: string; endpoint: string });
    case 'stellaragent_channel_status':
      return getChannelStatus(ctx);
    case 'stellaragent_rate_limits':
      return getRateLimits(ctx);
    case 'stellaragent_open_channel':
      return openPaymentChannel(ctx, args as {
        deposit: string;
        limitPerPeriod: string;
        period: 'hourly' | 'daily' | 'per_ledger';
        token?: string;
      });
    case 'stellaragent_create_job':
      return createEscrowJob(ctx, args as {
        workerAgent: string;
        task: string;
        escrowAmount: string;
        asset?: string;
      });
    case 'stellaragent_accept_job':
      return acceptEscrowJob(ctx, args as { jobId: string });
    case 'stellaragent_submit_job_result':
      return submitEscrowResult(ctx, args as { jobId: string; result: string });
    case 'stellaragent_release_job':
      return releaseEscrowPayment(ctx, args as { jobId: string });
    case 'stellaragent_get_job':
      return getEscrowJob(ctx, args as { jobId: string });
    default:
      return { ok: false, error: new ToolError('UNKNOWN_TOOL', `Unknown tool: ${name}`) };
  }
}

/** Legacy MCP-compatible shape. */
export function toMcpResult(response: ToolResponse): {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  refused?: boolean;
  reasons?: string[];
} {
  if (response.ok) return { ok: true, data: response.data };
  return {
    ok: false,
    error: response.error.message,
    refused: response.error.code === 'PAYMENT_REFUSED',
    reasons: response.error.reasons,
  };
}
