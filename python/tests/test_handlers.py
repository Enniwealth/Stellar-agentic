"""Tests for Python shared handlers — parity with TypeScript integration-shared."""

from stellaragent.integrations.errors import ToolError
from stellaragent.integrations.handlers import (
    AgentProtocol,
    HandlerContext,
    dispatch_tool_handler,
    quote_payment,
    pay_for_api,
    create_escrow_job,
    accept_escrow_job,
    submit_escrow_result,
    release_escrow_payment,
    get_escrow_job,
    open_payment_channel,
    get_channel_status,
    get_rate_limits,
    TOOL_SCHEMAS,
)
from stellaragent.integrations.langchain_tools import StellarAgentLangChainTools, TOOL_NAMES
from stellaragent.integrations.policy import PaymentPolicy, ToolContext


def _mock_agent() -> AgentProtocol:
    return AgentProtocol(
        address="GAGENT",
        pay_for_api=lambda **_: {"hash": "tx1", "success": True, "ledger": 100},
        get_spend_report=lambda: {
            "spentThisPeriod": "1",
            "remainingThisPeriod": "9",
            "totalLifetime": "1",
        },
        get_rate_limit_status=lambda: {"configured": True, "active": True},
        request_work=lambda **_: 42,
        accept_job=lambda _: {"hash": "tx2", "success": True},
        submit_result=lambda _j, _r: {"hash": "tx3", "success": True},
        release_payment=lambda _: {"hash": "tx4", "success": True},
        get_job=lambda _: {
            "id": 42,
            "status": "open",
            "requester": "G1",
            "worker": None,
            "amount": 100,
            "deadlineLedger": 999,
        },
        open_channel=lambda **_: 7,
    )


def test_all_tool_schemas_match_mcp_names() -> None:
    assert list(TOOL_SCHEMAS.keys()) == TOOL_NAMES
    assert len(TOOL_NAMES) == 10


def test_quote_without_submitting() -> None:
    ctx = HandlerContext(agent=_mock_agent(), policy=PaymentPolicy(session_budget="10"))
    result = quote_payment(ctx, "0.1", "GRECIP")
    assert result["ok"] is True
    assert result["data"]["wouldBlock"] is False


def test_refuses_over_budget_payment() -> None:
    ctx = HandlerContext(agent=_mock_agent(), policy=PaymentPolicy(session_budget="0.01"))
    result = pay_for_api(ctx, "1", "GRECIP", "https://api.example.com")
    assert result["ok"] is False
    assert isinstance(result["error"], ToolError)


def test_full_job_lifecycle() -> None:
    ctx = HandlerContext(agent=_mock_agent(), policy=PaymentPolicy(session_budget="10"))
    assert create_escrow_job(ctx, "GWORKER", "task", "0.1")["ok"] is True
    assert accept_escrow_job(ctx, "42")["ok"] is True
    assert submit_escrow_result(ctx, "42", "done")["ok"] is True
    assert release_escrow_payment(ctx, "42")["ok"] is True
    job = get_escrow_job(ctx, "42")
    assert job["ok"] is True
    assert job["data"]["status"] == "open"


def test_open_channel_and_status() -> None:
    ctx = HandlerContext(agent=_mock_agent(), policy=PaymentPolicy(session_budget="10"))
    channel = open_payment_channel(ctx, "5", "1", "hourly")
    assert channel["ok"] is True
    assert channel["data"]["channelId"] == "7"
    status = get_channel_status(ctx)
    assert status["data"]["remainingThisPeriod"] == "9"
    limits = get_rate_limits(ctx)
    assert limits["data"]["configured"] is True


def test_dispatch_unknown_tool() -> None:
    ctx = HandlerContext(agent=_mock_agent(), policy=PaymentPolicy(session_budget="10"))
    result = dispatch_tool_handler(ctx, "unknown_tool", {})
    assert result["ok"] is False
    assert result["error"].code == "UNKNOWN_TOOL"


def test_langchain_tools_no_stubs() -> None:
    tools = StellarAgentLangChainTools(
        ToolContext(policy=PaymentPolicy(session_budget="10"), agent=_mock_agent())
    )
    specs = tools.get_tools()
    assert len(specs) == 10
    for spec in specs:
        assert "See MCP tool" not in spec["description"]


def test_dry_run_skips_sdk_pay() -> None:
    agent = _mock_agent()
    calls: list[str] = []

    def tracking_pay(**_: object) -> dict[str, object]:
        calls.append("pay")
        return {"hash": "tx", "success": True}

    agent.pay_for_api = tracking_pay  # type: ignore[method-assign]
    ctx = HandlerContext(agent=agent, policy=PaymentPolicy(session_budget="10", dry_run=True))
    result = pay_for_api(ctx, "0.1", "GRECIP", "https://api.example.com")
    assert result["ok"] is True
    assert result["data"]["dryRun"] is True
    assert calls == []
