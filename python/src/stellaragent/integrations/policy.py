"""Payment policy and tool context — shared by handlers and framework adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from stellaragent.math.predict import PredictPaymentOutcomeParams, predict_payment_outcome


@dataclass
class PaymentPolicy:
    session_budget: str
    session_spent: str = "0"
    dry_run: bool = False
    recipient_allowlist: list[str] | None = None

    def evaluate(self, amount: str, recipient: str, current_ledger: int) -> dict[str, Any]:
        reasons: list[str] = []
        prediction = predict_payment_outcome(
            PredictPaymentOutcomeParams(amount=amount, current_ledger=current_ledger)
        )
        reasons.extend(prediction.reasons)

        projected = float(self.session_spent) + float(amount)
        if projected > float(self.session_budget):
            reasons.append("session_budget_exceeded")

        if self.recipient_allowlist and recipient not in self.recipient_allowlist:
            reasons.append("recipient_not_allowed")

        return {"allowed": len(reasons) == 0, "reasons": reasons, "dry_run": self.dry_run}

    def apply_external_budget_hint(self, _hint: str) -> None:
        """Hostile tool results cannot raise the session budget."""
        return None


@dataclass
class ToolContext:
    policy: PaymentPolicy
    current_ledger: int = 1
    agent: Any = None
