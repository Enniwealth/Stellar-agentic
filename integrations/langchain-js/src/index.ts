import type { StellarAgent } from '@stellaragent/core';
import {
  createToolContext,
  dispatchToolHandler,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  type PolicyConfig,
  type ToolContext,
} from '@stellaragent/integration-shared';

export interface LangChainToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  invoke: (input: Record<string, string>) => Promise<string>;
}

export class StellarAgentToolKit {
  private readonly ctx: ToolContext;

  constructor(agent: StellarAgent, policyConfig: PolicyConfig, currentLedger = 1) {
    this.ctx = createToolContext(agent, policyConfig, currentLedger);
  }

  get tools(): LangChainToolDefinition[] {
    return TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_SCHEMAS[name].description,
      schema: TOOL_SCHEMAS[name].inputSchema,
      invoke: async (input) => {
        const response = await dispatchToolHandler(this.ctx, name, input);
        return JSON.stringify(response.ok ? response.data : response.error.toJSON());
      },
    }));
  }

  /** Same audit log as MCP — shared policy instance. */
  get auditLog() {
    return this.ctx.policy.auditLog;
  }
}

export {
  PaymentPolicy,
  ToolError,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  createToolContext,
  dispatchToolHandler,
} from '@stellaragent/integration-shared';
