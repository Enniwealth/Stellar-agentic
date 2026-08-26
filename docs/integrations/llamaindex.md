# LlamaIndex Integration

```python
from stellaragent.integrations.llamaindex_tools import LlamaIndexToolSpec
from stellaragent.integrations.langchain_tools import PaymentPolicy

spec = LlamaIndexToolSpec(PaymentPolicy(session_budget="10", dry_run=True))
tools = spec.to_tool_specs()
```

Behaviour matches the MCP server and LangChain adapters — all three call the
same `predictPaymentOutcome` and `PaymentPolicy` semantics so spend authority
cannot diverge across frameworks.
