import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from config import INITIAL_CAPITAL, PAPER_STATE_FILE
from risk_manager import TradeParams, check_exit_conditions

logger = logging.getLogger(__name__)


@dataclass
class Trade:
    id: str
    symbol: str
    direction: str
    entry_price: float
    position_size: float
    position_value: float
    stop_loss_price: float
    take_profit_price: float
    risk_amount: float
    atr: float
    entry_time: str
    exit_price: float | None = None
    exit_time: str | None = None
    exit_reason: str | None = None
    pnl: float | None = None
    pnl_pct: float | None = None


class PaperTrader:
    def __init__(
        self,
        initial_capital: float = INITIAL_CAPITAL,
        state_file: str = PAPER_STATE_FILE,
    ):
        self._initial_capital = initial_capital
        self._state_file = state_file
        self._balance = initial_capital
        self._open_positions: list[Trade] = []
        self._trade_history: list[Trade] = []
        self._created_at = datetime.now(timezone.utc).isoformat()
        self.load_state()

    # ------------------------------------------------------------------
    # Persistance
    # ------------------------------------------------------------------

    def load_state(self) -> None:
        if not os.path.exists(self._state_file):
            return
        try:
            with open(self._state_file) as f:
                data = json.load(f)
            self._balance = data.get("balance", self._initial_capital)
            self._initial_capital = data.get("initial_balance", self._initial_capital)
            self._created_at = data.get("created_at", self._created_at)
            self._open_positions = [Trade(**t) for t in data.get("open_positions", [])]
            self._trade_history = [Trade(**t) for t in data.get("trade_history", [])]
            logger.info(
                "État paper chargé: solde=%.2f, %d positions ouvertes, %d trades historiques",
                self._balance,
                len(self._open_positions),
                len(self._trade_history),
            )
        except (json.JSONDecodeError, TypeError, KeyError) as exc:
            logger.warning("Impossible de charger %s: %s — on repart de zéro", self._state_file, exc)

    def save_state(self) -> None:
        tmp = self._state_file + ".tmp"
        data = {
            "balance": round(self._balance, 8),
            "initial_balance": self._initial_capital,
            "created_at": self._created_at,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "open_positions": [asdict(t) for t in self._open_positions],
            "trade_history": [asdict(t) for t in self._trade_history],
        }
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, self._state_file)

    # ------------------------------------------------------------------
    # Gestion des positions
    # ------------------------------------------------------------------

    def open_position(self, params: TradeParams) -> Trade | None:
        if any(p.symbol == params.symbol for p in self._open_positions):
            logger.debug("Position déjà ouverte sur %s — ignoré", params.symbol)
            return None

        if self._balance < params.position_value:
            logger.warning(
                "Solde insuffisant (%.2f) pour ouvrir %.2f sur %s",
                self._balance,
                params.position_value,
                params.symbol,
            )
            return None

        self._balance -= params.position_value

        trade = Trade(
            id=str(uuid.uuid4()),
            symbol=params.symbol,
            direction=params.direction,
            entry_price=params.entry_price,
            position_size=params.position_size,
            position_value=params.position_value,
            stop_loss_price=params.stop_loss_price,
            take_profit_price=params.take_profit_price,
            risk_amount=params.risk_amount,
            atr=params.atr,
            entry_time=datetime.now(timezone.utc).isoformat(),
        )
        self._open_positions.append(trade)
        self.save_state()

        logger.info(
            "[PAPER OPEN] %s %s @ %.4f | SL=%.4f | TP=%.4f | taille=%.6f | valeur=%.2f USDT | risque=%.2f USDT",
            trade.direction.upper(),
            trade.symbol,
            trade.entry_price,
            trade.stop_loss_price,
            trade.take_profit_price,
            trade.position_size,
            trade.position_value,
            trade.risk_amount,
        )
        return trade

    def close_position(self, trade_id: str, exit_price: float, reason: str) -> Trade | None:
        trade = next((t for t in self._open_positions if t.id == trade_id), None)
        if trade is None:
            logger.warning("Trade %s introuvable pour fermeture", trade_id)
            return None

        if trade.direction == "long":
            pnl = (exit_price - trade.entry_price) * trade.position_size
        else:
            pnl = (trade.entry_price - exit_price) * trade.position_size

        pnl_pct = pnl / trade.position_value * 100 if trade.position_value > 0 else 0.0

        trade.exit_price = exit_price
        trade.exit_time = datetime.now(timezone.utc).isoformat()
        trade.exit_reason = reason
        trade.pnl = round(pnl, 4)
        trade.pnl_pct = round(pnl_pct, 4)

        self._balance += trade.position_value + pnl
        self._open_positions.remove(trade)
        self._trade_history.append(trade)
        self.save_state()

        emoji = "✓" if pnl >= 0 else "✗"
        logger.info(
            "[PAPER CLOSE %s] %s %s @ %.4f | P&L=%.4f USDT (%.2f%%) | raison=%s | solde=%.2f",
            emoji,
            trade.direction.upper(),
            trade.symbol,
            exit_price,
            pnl,
            pnl_pct,
            reason,
            self._balance,
        )
        return trade

    def update_positions(self, prices: dict[str, float]) -> list[Trade]:
        """Vérifie SL/TP pour chaque position ouverte. Retourne les trades fermés."""
        closed = []
        for trade in list(self._open_positions):
            current_price = prices.get(trade.symbol)
            if current_price is None:
                continue
            reason = check_exit_conditions(asdict(trade), current_price)
            if reason:
                # Utiliser le prix SL/TP exact (simulation d'un ordre limite)
                if reason == "stop_loss":
                    exit_price = trade.stop_loss_price
                elif reason == "take_profit":
                    exit_price = trade.take_profit_price
                else:
                    exit_price = current_price
                closed_trade = self.close_position(trade.id, exit_price, reason)
                if closed_trade:
                    closed.append(closed_trade)
        return closed

    # ------------------------------------------------------------------
    # Accesseurs
    # ------------------------------------------------------------------

    def get_balance(self) -> float:
        return self._balance

    def get_open_positions(self) -> list[Trade]:
        return list(self._open_positions)

    def get_trade_history(self) -> list[Trade]:
        return list(self._trade_history)

    def get_pnl_summary(self) -> dict:
        history = self._trade_history
        if not history:
            return {
                "total_pnl": 0.0,
                "total_pnl_pct": 0.0,
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0.0,
                "max_drawdown_pct": 0.0,
                "current_balance": self._balance,
            }

        total_pnl = sum(t.pnl for t in history if t.pnl is not None)
        winners = [t for t in history if t.pnl is not None and t.pnl > 0]
        losers = [t for t in history if t.pnl is not None and t.pnl <= 0]
        win_rate = len(winners) / len(history) if history else 0.0
        total_pnl_pct = total_pnl / self._initial_capital * 100

        # Drawdown max (peak-to-trough sur le P&L cumulé)
        cumulative = 0.0
        peak = 0.0
        max_dd = 0.0
        for t in history:
            if t.pnl is not None:
                cumulative += t.pnl
                if cumulative > peak:
                    peak = cumulative
                dd = (peak - cumulative) / self._initial_capital * 100
                if dd > max_dd:
                    max_dd = dd

        return {
            "total_pnl": round(total_pnl, 4),
            "total_pnl_pct": round(total_pnl_pct, 2),
            "total_trades": len(history),
            "winning_trades": len(winners),
            "losing_trades": len(losers),
            "win_rate": round(win_rate, 4),
            "max_drawdown_pct": round(max_dd, 2),
            "current_balance": round(self._balance, 4),
        }
