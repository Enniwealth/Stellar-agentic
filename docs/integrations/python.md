# Python framework integrations

StellarAgent ships Python adapters with the same tool names and semantics as the TypeScript MCP server. All adapters dispatch through `stellaragent.integrations.handlers`, mirroring `integrations/shared/src/handlers.ts`.

## Installation

```bash
cd python
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## LangChain

```python
from stellaragent.integrations.langchain_tools import (
    PaymentPolicy,
    StellarAgentLangChainTools,
    ToolContext,
)

tools = StellarAgentLangChainTools(
    ToolContext(
        policy=PaymentPolicy(session_budget="10", dry_run=True),
        current_ledger=100,
    )
)

for spec in tools.get_tools():
    print(spec["name"], spec["description"])
```

## LlamaIndex

```python
from stellaragent.integrations.llamaindex_tools import LlamaIndexToolSpec
from stellaragent.integrations.langchain_tools import PaymentPolicy

spec = LlamaIndexToolSpec(PaymentPolicy(session_budget="10"))
tool_specs = spec.to_tool_specs()
assert spec.tool_names == [t["name"] for t in tool_specs]
```

## Tool surface (10 tools)

| Tool | Purpose |
|------|---------|
| `stellaragent_quote` | Predict blocks before spending |
| `stellaragent_pay` | Pay for an API call |
| `stellaragent_channel_status` | Spend report |
| `stellaragent_rate_limits` | On-chain rate limits |
| `stellaragent_open_channel` | Open payment channel |
| `stellaragent_create_job` | Create escrow job |
| `stellaragent_accept_job` | Worker accepts job |
| `stellaragent_submit_job_result` | Submit work result |
| `stellaragent_release_job` | Release escrow |
| `stellaragent_get_job` | Job metadata |

## Policy and safety

- Session budget is enforced in-process and cannot be raised by prompt injection (`apply_external_budget_hint` is a no-op).
- Refused payments raise `ToolError` with code `PAYMENT_REFUSED`.
- Tool results are scanned for secret key material before return.

## Wiring a live agent

Pass a StellarAgent instance (or `AgentProtocol`) on `ToolContext.agent`. Without an agent, read-only and dry-run tools still work; mutating tools return guidance messages instead of submitting transactions.

```python
from stellaragent import StellarAgent  # when installed

agent = await StellarAgent.create({"network": "testnet", "secretKey": "..."})
tools = StellarAgentLangChainTools(ToolContext(policy=policy, agent=agent))
```

## Parity with TypeScript

Run both test suites to verify behaviour alignment:

```bash
pnpm --filter @stellaragent/integration-shared test
python -m pytest python/tests/test_handlers.py python/tests/test_integrations.py
```
