"""LlamaIndex tool spec — parity with MCP and LangChain adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from stellaragent.integrations.langchain_tools import StellarAgentLangChainTools, TOOL_NAMES
from stellaragent.integrations.policy import PaymentPolicy, ToolContext


@dataclass
class LlamaIndexToolSpec:
    policy: PaymentPolicy
    current_ledger: int = 1
    agent: Any = None

    def to_tool_specs(self) -> list[dict[str, Any]]:
        base = StellarAgentLangChainTools(
            ToolContext(policy=self.policy, current_ledger=self.current_ledger, agent=self.agent)
        )
        specs: list[dict[str, Any]] = []
        for tool in base.get_tools():
            specs.append(
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "fn": tool["func"],
                }
            )
        return specs

    @property
    def tool_names(self) -> list[str]:
        return list(TOOL_NAMES)
