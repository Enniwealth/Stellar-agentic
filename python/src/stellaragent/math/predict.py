"""Payment-outcome prediction — semantic port of packages/core/src/math/predict.ts."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

LEDGERS_PER_CHANNEL_PERIOD = {
    "per_ledger": 1,
    "hourly": 720,
    "daily": 17280,
}
RATE_LIMIT_LEDGERS_PER_HOUR = 720
RATE_LIMIT_LEDGERS_PER_DAY = 17280


def _d(value: str) -> Decimal:
    return Decimal(value)


def is_window_expired(window_start: int, ledgers_per_window: int, current_ledger: int) -> bool:
    return current_ledger >= window_start + ledgers_per_window


@dataclass
class ChannelSpendState:
    active: bool
    limit_per_period: str
    spent_this_period: str
    period_start_ledger: int
    period: str


@dataclass
class RateLimitSpendState:
    configured: bool
    active: bool
    max_per_tx: str
    max_per_hour: str
    max_per_day: str
    max_txs_per_hour: int
    hourly_spend: str
    daily_spend: str
    hourly_tx_count: int
    hour_window_start_ledger: int
    day_window_start_ledger: int


@dataclass
class PredictPaymentOutcomeParams:
    amount: str
    current_ledger: int
    channel_state: ChannelSpendState | None = None
    rate_limit_state: RateLimitSpendState | None = None


@dataclass
class PaymentPrediction:
    would_block: bool
    reasons: list[str]


def predict_payment_outcome(params: PredictPaymentOutcomeParams) -> PaymentPrediction:
    reasons: list[str] = []
    amt = _d(params.amount)

    if amt <= 0:
        reasons.append("invalid_amount")

    if params.channel_state:
        ch = params.channel_state
        if not ch.active:
            reasons.append("channel_inactive")
        else:
            ledgers = LEDGERS_PER_CHANNEL_PERIOD[ch.period]
            expired = is_window_expired(ch.period_start_ledger, ledgers, params.current_ledger)
            effective_spent = _d("0") if expired else _d(ch.spent_this_period)
            limit = _d(ch.limit_per_period)
            if effective_spent + amt > limit:
                reasons.append("channel_spend_limit")

    if params.rate_limit_state and params.rate_limit_state.configured:
        rl = params.rate_limit_state
        if amt > _d(rl.max_per_tx):
            reasons.append("rate_limit_per_tx")

        hour_expired = is_window_expired(
            rl.hour_window_start_ledger, RATE_LIMIT_LEDGERS_PER_HOUR, params.current_ledger
        )
        day_expired = is_window_expired(
            rl.day_window_start_ledger, RATE_LIMIT_LEDGERS_PER_DAY, params.current_ledger
        )
        hourly_spend = _d("0") if hour_expired else _d(rl.hourly_spend)
        daily_spend = _d("0") if day_expired else _d(rl.daily_spend)
        hourly_tx_count = 0 if hour_expired else rl.hourly_tx_count

        if hourly_spend + amt > _d(rl.max_per_hour):
            reasons.append("rate_limit_hourly")
        if daily_spend + amt > _d(rl.max_per_day):
            reasons.append("rate_limit_daily")
        if hourly_tx_count >= rl.max_txs_per_hour:
            reasons.append("rate_limit_tx_count")

    return PaymentPrediction(would_block=len(reasons) > 0, reasons=reasons)
