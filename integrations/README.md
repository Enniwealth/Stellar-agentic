# StellarAgent Framework Integrations

Adapters that expose StellarAgent payments to MCP, LangChain, and LlamaIndex. All adapters dispatch through `@stellaragent/integration-shared` handlers so behaviour cannot diverge across frameworks.

## Architecture

```
┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐
│  MCP Server     │  │  LangChain (TS)  │  │  LangChain (Python) │
└────────┬────────┘  └────────┬─────────┘  └──────────┬──────────┘
         │                    │                         │
         └────────────────────┼─────────────────────────┘
                              ▼
                 integrations/shared/src/handlers.ts
                              │
                              ▼
                      @stellaragent/core SDK
```

Python adapters mirror the same tool surface via `stellaragent.integrations.handlers`.

## Tool surface (10 tools)

| Tool | Description |
|------|-------------|
| `stellaragent_quote` | Predict blocks before spending |
| `stellaragent_pay` | Pay for an API call |
| `stellaragent_channel_status` | Active channel spend report |
| `stellaragent_rate_limits` | On-chain rate limit status |
| `stellaragent_open_channel` | Open a payment channel |
| `stellaragent_create_job` | Create escrow job (A2A) |
| `stellaragent_accept_job` | Worker accepts job |
| `stellaragent_submit_job_result` | Submit work result |
| `stellaragent_release_job` | Release escrow to worker |
| `stellaragent_get_job` | Job metadata and status |

## MCP Server

```bash
AGENT_SECRET=S... SESSION_BUDGET=10 pnpm --filter @stellaragent/mcp-server dev
```

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_SECRET` | — | Stellar secret key (required) |
| `SESSION_BUDGET` | `10` | Max spend per MCP session |
| `DRY_RUN` | `false` | Quote-only mode, no chain writes |
| `RECIPIENT_ALLOWLIST` | — | Comma-separated allowed recipients |
| `STELLARAGENT_NETWORK` | `testnet` | `testnet` or `mainnet` |

See [docs/integrations/mcp.md](../docs/integrations/mcp.md).

## LangChain (TypeScript)

```typescript
import { StellarAgentToolKit } from '@stellaragent/langchain';

const kit = new StellarAgentToolKit(agent, {
  sessionBudget: '10',
  dryRun: false,
  recipientAllowlist: ['GRECIP...'],
});
const tools = kit.tools;
```

See [docs/integrations/langchain.md](../docs/integrations/langchain.md).

## LangChain (Python)

```python
from stellaragent.integrations.langchain_tools import StellarAgentLangChainTools
from stellaragent.integrations.policy import PaymentPolicy, ToolContext

tools = StellarAgentLangChainTools(
    ToolContext(policy=PaymentPolicy(session_budget="10"), agent=agent)
).get_tools()
```

See [docs/integrations/python.md](../docs/integrations/python.md).

## LlamaIndex

```python
from stellaragent.integrations.llamaindex_tools import LlamaIndexToolSpec
from stellaragent.integrations.policy import PaymentPolicy

specs = LlamaIndexToolSpec(PaymentPolicy(session_budget="10")).to_tool_specs()
```

See [docs/integrations/llamaindex.md](../docs/integrations/llamaindex.md).

## Safety layer

Shared policy in `@stellaragent/integration-shared` / `stellaragent.integrations.policy`:

- Per-session spend budget enforced in-process
- Per-recipient allowlists
- Dry-run mode for development
- Audit log of every tool-initiated payment attempt
- Hostile tool results cannot escalate spend authority (`applyExternalBudgetHint` is a no-op)
- Tool results scanned for secret key material before return

Typed errors (`ToolError` / `PAYMENT_REFUSED`) let agents handle refusals without parsing free-text errors.

## Examples

```bash
# Pay-for-API flow (dry run)
DRY_RUN=true AGENT_SECRET=S... tsx integrations/examples/pay-for-api.ts

# Agent-to-agent escrow lifecycle
DRY_RUN=true AGENT_SECRET=S... tsx integrations/examples/agent-to-agent-escrow.ts
```

## Testing

```bash
pnpm turbo run test --filter=@stellaragent/integration-shared --filter=@stellaragent/mcp-server --filter=@stellaragent/langchain
cd python && python -m pytest tests/test_handlers.py tests/test_integrations.py tests/test_policy.py
```

Live testnet smoke test (optional):

```bash
STELLARAGENT_LIVE_TEST=1 pnpm --filter @stellaragent/mcp-server test
```

## Package layout

```
integrations/
├── shared/          # Single source of truth for tool handlers
├── mcp-server/      # MCP stdio server
├── langchain-js/    # LangChain StructuredTool bindings
└── examples/        # Runnable reference implementations
```
