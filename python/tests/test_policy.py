"""Tests for payment policy."""

from stellaragent.integrations.policy import PaymentPolicy


def test_recipient_allowlist_blocks() -> None:
    policy = PaymentPolicy(session_budget="10", recipient_allowlist=["GALLOWED"])
    decision = policy.evaluate("0.1", "GBLOCKED", 100)
    assert decision["allowed"] is False
    assert "recipient_not_allowed" in decision["reasons"]


def test_session_budget_blocks() -> None:
    policy = PaymentPolicy(session_budget="1.0", session_spent="0.9")
    decision = policy.evaluate("0.5", "GANY", 100)
    assert decision["allowed"] is False
    assert "session_budget_exceeded" in decision["reasons"]
