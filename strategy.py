from dataclasses import dataclass
from enum import Enum

import numpy as np
import pandas as pd
import pandas_ta as ta

from config import (
    ATR_PERIOD,
    BB_PERIOD,
    BB_STD,
    HIGH_REACTIVITY_CANDLES,
    MACD_FAST,
    MACD_SIGNAL,
    MACD_SLOW,
    RSI_OVERBOUGHT,
    RSI_OVERSOLD,
    RSI_PERIOD,
)

_MIN_CANDLES = MACD_SLOW + MACD_SIGNAL + 10


class SignalType(Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


@dataclass
class Signal:
    signal_type: SignalType
    entry_price: float
    atr: float
    bb_width: float
    rsi: float
    macd_hist: float
    reason: str


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calcule RSI, MACD, Bandes de Bollinger et ATR sur le DataFrame OHLCV."""
    if len(df) < _MIN_CANDLES:
        raise ValueError(f"Minimum {_MIN_CANDLES} bougies requises, reçu {len(df)}")

    df = df.copy()

    df["rsi"] = ta.rsi(df["close"], length=RSI_PERIOD)

    macd = ta.macd(df["close"], fast=MACD_FAST, slow=MACD_SLOW, signal=MACD_SIGNAL)
    hist_col = f"MACDh_{MACD_FAST}_{MACD_SLOW}_{MACD_SIGNAL}"
    df["macd_hist"] = macd[hist_col] if macd is not None and hist_col in macd.columns else np.nan

    bb = ta.bbands(df["close"], length=BB_PERIOD, std=BB_STD)
    if bb is not None:
        df["bb_lower"] = bb[f"BBL_{BB_PERIOD}_{BB_STD}"]
        df["bb_upper"] = bb[f"BBU_{BB_PERIOD}_{BB_STD}"]
        df["bb_mid"] = bb[f"BBM_{BB_PERIOD}_{BB_STD}"]
        df["bb_width"] = df["bb_upper"] - df["bb_lower"]
    else:
        df["bb_lower"] = df["bb_upper"] = df["bb_mid"] = df["bb_width"] = np.nan

    df["atr"] = ta.atr(df["high"], df["low"], df["close"], length=ATR_PERIOD)

    return df


def _is_high_reactivity(df: pd.DataFrame) -> bool:
    """Vérifie si l'ATR des 48h est supérieur à la médiane globale disponible."""
    if "atr" not in df.columns or df["atr"].isna().all():
        return True  # pas assez de données → pas de filtre

    recent_window = min(HIGH_REACTIVITY_CANDLES, len(df))
    recent_atr = df["atr"].iloc[-recent_window:].mean()
    global_median = df["atr"].median()

    if global_median == 0 or np.isnan(global_median):
        return True

    return recent_atr >= global_median * 0.9  # 90% de la médiane globale suffit


def generate_signal(df: pd.DataFrame) -> Signal:
    """
    Génère un signal de trading en analysant la dernière bougie complète (index -2).
    Retourne HOLD si les conditions ne sont pas remplies.
    """
    df = compute_indicators(df)

    # Bougie -1 = en cours de formation, -2 = dernière complète
    last = df.iloc[-2]
    prev = df.iloc[-3]

    entry_price = float(last["close"])
    atr = float(last["atr"]) if not np.isnan(last["atr"]) else 0.0
    bb_width = float(last["bb_width"]) if not np.isnan(last["bb_width"]) else 0.0
    rsi = float(last["rsi"]) if not np.isnan(last["rsi"]) else 50.0
    macd_hist = float(last["macd_hist"]) if not np.isnan(last["macd_hist"]) else 0.0
    prev_macd = float(prev["macd_hist"]) if not np.isnan(prev["macd_hist"]) else 0.0

    _hold = Signal(
        signal_type=SignalType.HOLD,
        entry_price=entry_price,
        atr=atr,
        bb_width=bb_width,
        rsi=rsi,
        macd_hist=macd_hist,
        reason="aucun signal",
    )

    if atr == 0.0:
        return _hold

    if not _is_high_reactivity(df):
        _hold.reason = "hors fenêtre de réactivité 48h"
        return _hold

    # --- Signal LONG ---
    rsi_oversold = rsi < RSI_OVERSOLD
    macd_bullish_cross = prev_macd < 0 < macd_hist
    price_at_lower_bb = (
        not np.isnan(last["bb_lower"]) and entry_price <= float(last["bb_lower"]) * 1.002
    )

    if (rsi_oversold or macd_bullish_cross) and price_at_lower_bb:
        triggers = []
        if rsi_oversold:
            triggers.append(f"RSI={rsi:.1f}<{RSI_OVERSOLD}")
        if macd_bullish_cross:
            triggers.append(f"MACD cross haussier ({prev_macd:.4f}→{macd_hist:.4f})")
        return Signal(
            signal_type=SignalType.BUY,
            entry_price=entry_price,
            atr=atr,
            bb_width=bb_width,
            rsi=rsi,
            macd_hist=macd_hist,
            reason=f"LONG: {', '.join(triggers)} + prix≤BB_basse",
        )

    # --- Signal SHORT (ignoré sur spot Binance — retourne HOLD) ---
    rsi_overbought = rsi > RSI_OVERBOUGHT
    macd_bearish_cross = prev_macd > 0 > macd_hist
    price_at_upper_bb = (
        not np.isnan(last["bb_upper"]) and entry_price >= float(last["bb_upper"]) * 0.998
    )

    if (rsi_overbought or macd_bearish_cross) and price_at_upper_bb:
        # Short non supporté sur spot → signal informatif uniquement
        triggers = []
        if rsi_overbought:
            triggers.append(f"RSI={rsi:.1f}>{RSI_OVERBOUGHT}")
        if macd_bearish_cross:
            triggers.append(f"MACD cross baissier ({prev_macd:.4f}→{macd_hist:.4f})")
        _hold.reason = f"SHORT ignoré (spot): {', '.join(triggers)} + prix≥BB_haute"
        return _hold

    return _hold
