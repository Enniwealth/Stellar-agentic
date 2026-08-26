#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { StellarAgent } from '@stellaragent/core';
import {
  TOOL_DEFINITIONS,
  dispatchTool,
  createMcpContext,
} from './tools.js';

export interface McpServerOptions {
  agent: StellarAgent;
  sessionBudget: string;
  dryRun?: boolean;
  recipientAllowlist?: string[];
  currentLedger?: number;
}

export async function createMcpServer(options: McpServerOptions): Promise<Server> {
  const ctx = createMcpContext(
    options.agent,
    {
      sessionBudget: options.sessionBudget,
      dryRun: options.dryRun,
      recipientAllowlist: options.recipientAllowlist,
    },
    options.currentLedger ?? 1,
  );

  const server = new Server(
    { name: 'stellaragent-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, string>;
    const result = await dispatchTool(ctx, request.params.name, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  });

  return server;
}

async function main(): Promise<void> {
  const secretKey = process.env.AGENT_SECRET;
  if (!secretKey) {
    console.error('AGENT_SECRET is required');
    process.exit(1);
  }

  const agent = await StellarAgent.create({
    network: (process.env.STELLARAGENT_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    secretKey,
    allowUnconfiguredContracts: process.env.ALLOW_UNCONFIGURED === 'true',
  });

  const server = await createMcpServer({
    agent,
    sessionBudget: process.env.SESSION_BUDGET ?? '10',
    dryRun: process.env.DRY_RUN === 'true',
    recipientAllowlist: process.env.RECIPIENT_ALLOWLIST?.split(',').filter(Boolean),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { dispatchTool, TOOL_DEFINITIONS, createMcpContext, TOOL_NAMES, TOOL_SCHEMAS } from './tools.js';
