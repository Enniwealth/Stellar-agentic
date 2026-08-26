# LangChain Integration

TypeScript and Python tool adapters over the same policy layer as the MCP server.

## TypeScript

```typescript
import { StellarAgent } from '@stellaragent/core';
import { StellarAgentToolKit } from '@stellaragent/langchain';

const agent = await StellarAgent.create({ network: 'testnet', secretKey: 'S...' });
const kit = new StellarAgentToolKit(agent, { sessionBudget: '10', dryRun: true });

for (const tool of kit.tools) {
  // Register with LangChain agent — tool.invoke(input) returns JSON string
}
```

## Python

```python
from stellaragent.integrations.langchain_tools import PaymentPolicy, StellarAgentLangChainTools

policy = PaymentPolicy(session_budget="10")
tools = StellarAgentLangChainTools(policy).get_tools()
```

Typed errors surface as `reasons` arrays an agent can reason about.
