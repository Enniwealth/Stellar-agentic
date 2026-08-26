/**
 * MCP tool surface — thin wrapper over @stellaragent/integration-shared handlers.
 */
import type { StellarAgent } from '@stellaragent/core';
import {
  PaymentPolicy,
  type PolicyConfig,
  dispatchToolHandler,
  TOOL_SCHEMAS,
  TOOL_NAMES,
  toMcpResult,
  createToolContext,
  type ToolContext,
} from '@stellaragent/integration-shared';

export type { ToolContext };

export interface ToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  refused?: boolean;
  reasons?: string[];
}

export function createPolicy(config: PolicyConfig): PaymentPolicy {
  return new PaymentPolicy(config);
}

export const TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({
  name,
  description: TOOL_SCHEMAS[name].description,
  inputSchema: TOOL_SCHEMAS[name].inputSchema,
}));

export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  return toMcpResult(await dispatchToolHandler(ctx, name, args));
}

export function createMcpContext(
  agent: StellarAgent,
  policyConfig: PolicyConfig,
  currentLedger = 1,
): ToolContext {
  return createToolContext(agent, policyConfig, currentLedger);
}

export { TOOL_NAMES, TOOL_SCHEMAS, createToolContext, dispatchToolHandler, toMcpResult };
