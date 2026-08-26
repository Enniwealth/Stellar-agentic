"""LangChain tools — parity with MCP tool surface."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from stellaragent.integrations.errors import ToolError, payment_refused
from stellaragent.integrations.handlers import (
    HandlerContext,
    TOOL_SCHEMAS,
    create_handler_context,
    dispatch_tool_handler,
    to_agent_result,
)
from stellaragent.integrations.policy import PaymentPolicy, ToolContext
from stellaragent.math.predict import PaymentPrediction, PredictPaymentOutcomeParams, predict_payment_outcome

TOOL_NAMES = list(TOOL_SCHEMAS.keys())


@dataclass
class StellarAgentLangChainTools:
    """Tool specs for LangChain agents — same names and semantics as MCP."""

    ctx: ToolContext
    audit_log: list[dict[str, Any]] = field(default_factory=list)

    @property
    def _handler_ctx(self) -> HandlerContext:
        hctx = create_handler_context(self.ctx.agent, self.ctx.policy, self.ctx.current_ledger)
        hctx.audit_log = self.audit_log
        return hctx

    def quote_tool(self, amount: str, recipient: str) -> dict[str, Any]:
        return to_agent_result(dispatch_tool_handler(self._handler_ctx, "stellaragent_quote", {
            "amount": amount,
            "recipient": recipient,
        }))

    def pay_tool(self, amount: str, recipient: str, endpoint: str) -> dict[str, Any]:
        response = dispatch_tool_handler(
            self._handler_ctx,
            "stellaragent_pay",
            {"amount": amount, "recipient": recipient, "endpoint": endpoint},
        )
        if not response["ok"]:
            err = response["error"]
            if isinstance(err, ToolError) and err.code == "PAYMENT_REFUSED":
                raise payment_refused(err.reasons or [])
            raise err
        return to_agent_result(response)

    def _dispatch(self, name: str, args: dict[str, str]) -> dict[str, Any]:
        response = dispatch_tool_handler(self._handler_ctx, name, args)
        if not response["ok"]:
            err = response["error"]
            if isinstance(err, ToolError) and err.code == "PAYMENT_REFUSED":
                raise payment_refused(err.reasons or [])
            raise err
        return to_agent_result(response)

    def channel_status_tool(self) -> dict[str, Any]:
        return self._dispatch("stellaragent_channel_status", {})

    def rate_limits_tool(self) -> dict[str, Any]:
        return self._dispatch("stellaragent_rate_limits", {})

    def open_channel_tool(
        self,
        deposit: str,
        limit_per_period: str,
        period: str,
        token: str | None = None,
    ) -> dict[str, Any]:
        args: dict[str, str] = {
            "deposit": deposit,
            "limitPerPeriod": limit_per_period,
            "period": period,
        }
        if token:
            args["token"] = token
        return self._dispatch("stellaragent_open_channel", args)

    def create_job_tool(
        self,
        worker_agent: str,
        task: str,
        escrow_amount: str,
        asset: str | None = None,
    ) -> dict[str, Any]:
        args: dict[str, str] = {
            "workerAgent": worker_agent,
            "task": task,
            "escrowAmount": escrow_amount,
        }
        if asset:
            args["asset"] = asset
        return self._dispatch("stellaragent_create_job", args)

    def accept_job_tool(self, job_id: str) -> dict[str, Any]:
        return self._dispatch("stellaragent_accept_job", {"jobId": job_id})

    def submit_job_result_tool(self, job_id: str, result: str) -> dict[str, Any]:
        return self._dispatch("stellaragent_submit_job_result", {"jobId": job_id, "result": result})

    def release_job_tool(self, job_id: str) -> dict[str, Any]:
        return self._dispatch("stellaragent_release_job", {"jobId": job_id})

    def get_job_tool(self, job_id: str) -> dict[str, Any]:
        return self._dispatch("stellaragent_get_job", {"jobId": job_id})

    def get_tools(self) -> list[dict[str, Any]]:
        bindings: dict[str, Callable[..., dict[str, Any]]] = {
            "stellaragent_quote": lambda amount, recipient: self.quote_tool(amount, recipient),
            "stellaragent_pay": lambda amount, recipient, endpoint: self.pay_tool(amount, recipient, endpoint),
            "stellaragent_channel_status": lambda: self.channel_status_tool(),
            "stellaragent_rate_limits": lambda: self.rate_limits_tool(),
            "stellaragent_open_channel": self.open_channel_tool,
            "stellaragent_create_job": self.create_job_tool,
            "stellaragent_accept_job": self.accept_job_tool,
            "stellaragent_submit_job_result": self.submit_job_result_tool,
            "stellaragent_release_job": self.release_job_tool,
            "stellaragent_get_job": self.get_job_tool,
        }
        tools: list[dict[str, Any]] = []
        for name in TOOL_NAMES:
            schema = TOOL_SCHEMAS[name]
            tools.append({
                "name": name,
                "description": schema["description"],
                "func": bindings[name],
            })
        return tools


def predict_for_tool(amount: str, current_ledger: int) -> PaymentPrediction:
    return predict_payment_outcome(
        PredictPaymentOutcomeParams(amount=amount, current_ledger=current_ledger)
    )
