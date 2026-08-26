"""Shared tool handlers — Python parity with integrations/shared/src/handlers.ts."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from stellaragent.integrations.errors import ToolError, payment_refused
from stellaragent.integrations.policy import PaymentPolicy, ToolContext

Period = Literal["hourly", "daily", "per_ledger"]

_KEY_PATTERN = re.compile(r"S[A-Z2-7]{55}")


class ToolSuccess(TypedDict):
    ok: Literal[True]
    data: dict[str, Any]


class ToolFailure(TypedDict):
    ok: Literal[False]
    error: ToolError


ToolResponse = ToolSuccess | ToolFailure


def _safe_data(data: dict[str, Any]) -> dict[str, Any]:
    serialized = str(data)
    if _KEY_PATTERN.search(serialized):
        raise ToolError(
            code="KEY_MATERIAL_BLOCKED",
            message="Tool result would expose key material",
        )
    return data


def _success(data: dict[str, Any]) -> ToolSuccess:
    return {"ok": True, "data": _safe_data(data)}


def _refuse(reasons: list[str]) -> ToolFailure:
    return {"ok": False, "error": payment_refused(reasons)}


@dataclass
class AgentProtocol:
    """Minimal StellarAgent surface used by handlers."""

    address: str = "GAGENT"
    pay_for_api: Callable[..., dict[str, Any]] | None = None
    get_spend_report: Callable[[], dict[str, Any]] | None = None
    get_rate_limit_status: Callable[[], dict[str, Any]] | None = None
    request_work: Callable[..., int] | None = None
    accept_job: Callable[[int], dict[str, Any]] | None = None
    submit_result: Callable[[int, str], dict[str, Any]] | None = None
    release_payment: Callable[[int], dict[str, Any]] | None = None
    get_job: Callable[[int], dict[str, Any]] | None = None
    open_channel: Callable[..., int] | None = None


@dataclass
class HandlerContext:
    agent: AgentProtocol
    policy: PaymentPolicy
    current_ledger: int = 1
    audit_log: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_tool_context(cls, ctx: ToolContext) -> HandlerContext:
        agent = ctx.agent if isinstance(ctx.agent, AgentProtocol) else AgentProtocol()
        return cls(agent=agent, policy=ctx.policy, current_ledger=ctx.current_ledger)


def create_handler_context(
    agent: Any,
    policy: PaymentPolicy,
    current_ledger: int = 1,
) -> HandlerContext:
    if isinstance(agent, AgentProtocol):
        return HandlerContext(agent=agent, policy=policy, current_ledger=current_ledger)
    return HandlerContext(
        agent=AgentProtocol(address=getattr(agent, "address", "GAGENT")),
        policy=policy,
        current_ledger=current_ledger,
    )


def quote_payment(ctx: HandlerContext, amount: str, recipient: str) -> ToolResponse:
    decision = ctx.policy.evaluate(amount, recipient, ctx.current_ledger)
    ctx.audit_log.append({"tool": "quote", "allowed": decision["allowed"], "reasons": decision["reasons"]})
    return _success(
        {
            "wouldBlock": not decision["allowed"],
            "reasons": decision["reasons"],
            "remainingSessionBudget": str(
                float(ctx.policy.session_budget) - float(ctx.policy.session_spent)
            ),
        }
    )


def pay_for_api(ctx: HandlerContext, amount: str, recipient: str, endpoint: str) -> ToolResponse:
    decision = ctx.policy.evaluate(amount, recipient, ctx.current_ledger)
    if not decision["allowed"]:
        ctx.audit_log.append({"tool": "pay", "refused": True, "reasons": decision["reasons"]})
        return _refuse(decision["reasons"])

    payment_id = f"pay-{int(__import__('time').time() * 1000)}"
    if decision["dry_run"]:
        ctx.policy.session_spent = str(float(ctx.policy.session_spent) + float(amount))
        return _success(
            {"dryRun": True, "paymentId": payment_id, "amount": amount, "recipient": recipient}
        )

    if ctx.agent.pay_for_api is None:
        return _success({"ok": True, "message": "Wire StellarAgent SDK agent for live pay", "paymentId": payment_id})

    try:
        tx = ctx.agent.pay_for_api(endpoint=endpoint, amount=amount, recipient=recipient)
        ctx.policy.session_spent = str(float(ctx.policy.session_spent) + float(amount))
        return _success(
            {
                "paymentId": payment_id,
                "hash": tx.get("hash"),
                "success": tx.get("success", True),
                "ledger": tx.get("ledger"),
            }
        )
    except Exception as exc:  # noqa: BLE001 — surfaced as typed ToolError
        raise ToolError(code="SDK_ERROR", message=str(exc), retryable=True) from exc


def get_channel_status(ctx: HandlerContext) -> ToolResponse:
    if ctx.agent.get_spend_report is None:
        return _success({"spentThisPeriod": "0", "remainingThisPeriod": "0", "totalLifetime": "0"})
    report = ctx.agent.get_spend_report()
    return _success(dict(report))


def get_rate_limits(ctx: HandlerContext) -> ToolResponse:
    if ctx.agent.get_rate_limit_status is None:
        return _success({"configured": False, "active": True})
    status = ctx.agent.get_rate_limit_status()
    return _success(dict(status))


def create_escrow_job(
    ctx: HandlerContext,
    worker_agent: str,
    task: str,
    escrow_amount: str,
    asset: str | None = None,
) -> ToolResponse:
    if ctx.agent.request_work is None:
        return _success({"jobId": "0", "note": "Wire SDK agent.requestWork for live jobs"})
    kwargs: dict[str, Any] = {
        "worker_agent": worker_agent,
        "task": task,
        "escrow_amount": escrow_amount,
    }
    if asset is not None:
        kwargs["asset"] = asset
    job_id = ctx.agent.request_work(**kwargs)
    return _success({"jobId": str(job_id)})


def accept_escrow_job(ctx: HandlerContext, job_id: str) -> ToolResponse:
    if ctx.agent.accept_job is None:
        return _success({"jobId": job_id, "note": "Wire SDK agent.acceptJob"})
    tx = ctx.agent.accept_job(int(job_id))
    return _success({"jobId": job_id, "hash": tx.get("hash"), "success": tx.get("success", True)})


def submit_escrow_result(ctx: HandlerContext, job_id: str, result: str) -> ToolResponse:
    if ctx.agent.submit_result is None:
        return _success({"jobId": job_id, "note": "Wire SDK agent.submitResult"})
    tx = ctx.agent.submit_result(int(job_id), result)
    return _success({"jobId": job_id, "hash": tx.get("hash"), "success": tx.get("success", True)})


def release_escrow_payment(ctx: HandlerContext, job_id: str) -> ToolResponse:
    if ctx.agent.release_payment is None:
        return _success({"jobId": job_id, "note": "Wire SDK agent.releasePayment"})
    tx = ctx.agent.release_payment(int(job_id))
    return _success({"jobId": job_id, "hash": tx.get("hash"), "success": tx.get("success", True)})


def get_escrow_job(ctx: HandlerContext, job_id: str) -> ToolResponse:
    if ctx.agent.get_job is None:
        return _success({"id": job_id, "status": "unknown", "note": "Wire SDK agent.getJob"})
    job = ctx.agent.get_job(int(job_id))
    return _success(
        {
            "id": str(job.get("id", job_id)),
            "status": job.get("status"),
            "requester": job.get("requester"),
            "worker": job.get("worker"),
            "amount": str(job.get("amount", "0")),
            "deadlineLedger": job.get("deadlineLedger"),
        }
    )


def open_payment_channel(
    ctx: HandlerContext,
    deposit: str,
    limit_per_period: str,
    period: Period,
    token: str | None = None,
) -> ToolResponse:
    if ctx.agent.open_channel is None:
        return _success({"channelId": "0", "note": "Wire SDK agent.openChannel"})
    kwargs: dict[str, Any] = {
        "deposit": deposit,
        "limit_per_period": limit_per_period,
        "period": period,
    }
    if token is not None:
        kwargs["token"] = token
    channel_id = ctx.agent.open_channel(**kwargs)
    return _success({"channelId": str(channel_id)})


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "stellaragent_quote": {
        "description": "Predict whether a payment would be blocked before spending",
        "inputSchema": {
            "type": "object",
            "properties": {"amount": {"type": "string"}, "recipient": {"type": "string"}},
            "required": ["amount", "recipient"],
        },
    },
    "stellaragent_pay": {
        "description": "Pay for an API call through the agent payment channel",
        "inputSchema": {
            "type": "object",
            "properties": {
                "amount": {"type": "string"},
                "recipient": {"type": "string"},
                "endpoint": {"type": "string"},
            },
            "required": ["amount", "recipient", "endpoint"],
        },
    },
    "stellaragent_channel_status": {
        "description": "Get spend report for the active payment channel",
        "inputSchema": {"type": "object", "properties": {}},
    },
    "stellaragent_rate_limits": {
        "description": "Get on-chain rate limit status for this agent",
        "inputSchema": {"type": "object", "properties": {}},
    },
    "stellaragent_open_channel": {
        "description": "Open a payment channel with deposit and period limit",
        "inputSchema": {
            "type": "object",
            "properties": {
                "deposit": {"type": "string"},
                "limitPerPeriod": {"type": "string"},
                "period": {"type": "string", "enum": ["hourly", "daily", "per_ledger"]},
                "token": {"type": "string"},
            },
            "required": ["deposit", "limitPerPeriod", "period"],
        },
    },
    "stellaragent_create_job": {
        "description": "Create an escrow job for agent-to-agent work",
        "inputSchema": {
            "type": "object",
            "properties": {
                "workerAgent": {"type": "string"},
                "task": {"type": "string"},
                "escrowAmount": {"type": "string"},
                "asset": {"type": "string"},
            },
            "required": ["workerAgent", "task", "escrowAmount"],
        },
    },
    "stellaragent_accept_job": {
        "description": "Accept an open escrow job as the worker agent",
        "inputSchema": {
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId"],
        },
    },
    "stellaragent_submit_job_result": {
        "description": "Submit work result for an escrow job",
        "inputSchema": {
            "type": "object",
            "properties": {"jobId": {"type": "string"}, "result": {"type": "string"}},
            "required": ["jobId", "result"],
        },
    },
    "stellaragent_release_job": {
        "description": "Release escrow payment to the worker after work is complete",
        "inputSchema": {
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId"],
        },
    },
    "stellaragent_get_job": {
        "description": "Get escrow job status and metadata",
        "inputSchema": {
            "type": "object",
            "properties": {"jobId": {"type": "string"}},
            "required": ["jobId"],
        },
    },
}


def dispatch_tool_handler(ctx: HandlerContext, name: str, args: dict[str, str]) -> ToolResponse:
    match name:
        case "stellaragent_quote":
            return quote_payment(ctx, args["amount"], args["recipient"])
        case "stellaragent_pay":
            return pay_for_api(ctx, args["amount"], args["recipient"], args["endpoint"])
        case "stellaragent_channel_status":
            return get_channel_status(ctx)
        case "stellaragent_rate_limits":
            return get_rate_limits(ctx)
        case "stellaragent_open_channel":
            return open_payment_channel(
                ctx,
                args["deposit"],
                args["limitPerPeriod"],
                args["period"],  # type: ignore[arg-type]
                args.get("token"),
            )
        case "stellaragent_create_job":
            return create_escrow_job(
                ctx,
                args["workerAgent"],
                args["task"],
                args["escrowAmount"],
                args.get("asset"),
            )
        case "stellaragent_accept_job":
            return accept_escrow_job(ctx, args["jobId"])
        case "stellaragent_submit_job_result":
            return submit_escrow_result(ctx, args["jobId"], args["result"])
        case "stellaragent_release_job":
            return release_escrow_payment(ctx, args["jobId"])
        case "stellaragent_get_job":
            return get_escrow_job(ctx, args["jobId"])
        case _:
            return {"ok": False, "error": ToolError(code="UNKNOWN_TOOL", message=f"Unknown tool: {name}")}


def to_agent_result(response: ToolResponse) -> dict[str, Any]:
    if response["ok"]:
        return {"ok": True, **response["data"]}
    err = response["error"]
    return {
        "ok": False,
        "error": err.message,
        "refused": err.code == "PAYMENT_REFUSED",
        "reasons": err.reasons,
    }
