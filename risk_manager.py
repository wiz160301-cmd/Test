from dataclasses import dataclass

from config import (
    INITIAL_CAPITAL,
    RISK_PER_TRADE_PCT,
    SLIPPAGE_PCT,
    STOP_LOSS_PCT,
    TP_ATR_MAX,
    TP_ATR_MULTIPLIER,
)
from strategy import Signal, SignalType


@dataclass
class TradeParams:
    symbol: str
    direction: str          # "long"
    entry_price: float
    position_size: float    # en devise de base (ex: BTC)
    position_value: float   # en devise de cotation (ex: USDT)
    stop_loss_price: float
    take_profit_price: float
    risk_amount: float      # USDT réellement risqués
    atr: float


def calculate_position(
    signal: Signal,
    symbol: str,
    balance: float,
    current_price: float,
) -> TradeParams | None:
    """
    Calcule les paramètres d'un trade en respectant la règle des 2% de risque.
    Retourne None si les données sont insuffisantes ou la position trop petite.
    """
    if signal.signal_type != SignalType.BUY:
        return None

    if signal.atr <= 0:
        return None

    # Prix d'entrée simulé avec slippage (achat = prix légèrement plus élevé)
    entry_price = current_price * (1 + SLIPPAGE_PCT)

    # --- Calcul de la taille de position ---
    max_risk = balance * RISK_PER_TRADE_PCT          # ex: 1000 × 0.02 = 20 USDT
    stop_distance = entry_price * STOP_LOSS_PCT      # ex: 50000 × 0.01 = 500 USDT
    position_size = max_risk / stop_distance         # ex: 20 / 500 = 0.04 BTC
    position_value = position_size * entry_price     # ex: 0.04 × 50000 = 2000 USDT

    # Plafonner à 95% du solde disponible (pas de levier)
    max_allowed = balance * 0.95
    if position_value > max_allowed:
        position_value = max_allowed
        position_size = position_value / entry_price

    risk_amount = position_size * stop_distance

    # Ignorer les trades de poussière (< 0.50 USDT de risque)
    if risk_amount < 0.50:
        return None

    # --- Stop-Loss ---
    stop_loss_price = entry_price * (1 - STOP_LOSS_PCT)

    # --- Take-Profit dynamique (ATR × multiplicateur, plafonné) ---
    atr_tp_min = entry_price + signal.atr * TP_ATR_MULTIPLIER
    atr_tp_max = entry_price + signal.atr * TP_ATR_MAX

    # Alternative : utiliser la moitié de la largeur des Bandes de Bollinger
    bb_tp = entry_price + signal.bb_width * 0.5 if signal.bb_width > 0 else atr_tp_min

    take_profit_price = max(atr_tp_min, bb_tp)
    take_profit_price = min(take_profit_price, atr_tp_max)

    # Vérification ratio risque/rendement minimum (1.5:1)
    reward = take_profit_price - entry_price
    risk = entry_price - stop_loss_price
    if risk > 0 and reward / risk < 1.5:
        take_profit_price = entry_price + risk * 1.5

    return TradeParams(
        symbol=symbol,
        direction="long",
        entry_price=entry_price,
        position_size=round(position_size, 8),
        position_value=round(position_value, 4),
        stop_loss_price=round(stop_loss_price, 4),
        take_profit_price=round(take_profit_price, 4),
        risk_amount=round(risk_amount, 4),
        atr=signal.atr,
    )


def check_exit_conditions(trade: "dict", current_price: float) -> str | None:
    """
    Vérifie si le prix actuel déclenche le SL ou le TP.
    trade est un dict avec les clés stop_loss_price, take_profit_price, direction.
    Retourne "stop_loss", "take_profit" ou None.
    """
    direction = trade.get("direction", "long")

    if direction == "long":
        if current_price <= trade["stop_loss_price"]:
            return "stop_loss"
        if current_price >= trade["take_profit_price"]:
            return "take_profit"

    return None
