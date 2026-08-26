"""Typed errors for Python framework adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ToolError(Exception):
    code: str
    message: str
    reasons: list[str] | None = None
    retryable: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": "ToolError",
            "code": self.code,
            "message": self.message,
            "reasons": self.reasons,
            "retryable": self.retryable,
        }


def payment_refused(reasons: list[str]) -> ToolError:
    return ToolError(
        code="PAYMENT_REFUSED",
        message=f"Payment refused: {', '.join(reasons)}",
        reasons=reasons,
    )
