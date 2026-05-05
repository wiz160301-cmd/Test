"""
Bot de trading algorithmique — scalping/day trading sur Binance via ccxt.

Modes disponibles (via .env) :
  PAPER_TRADING=true            → simulation locale, aucun ordre réel
  TESTNET=true, PAPER_TRADING=false → ordres sur testnet.binance.vision (argent fictif)
  TESTNET=false, PAPER_TRADING=false → trading réel Binance production (argent réel !)
"""

import asyncio
import logging
import signal
import sys
from logging.handlers import RotatingFileHandler

import ccxt
import pandas as pd
from dotenv import load_dotenv

import config
from paper_trader import PaperTrader
from risk_manager import calculate_position
from strategy import SignalType, generate_signal

load_dotenv()


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    logger = logging.getLogger("trading_bot")
    logger.setLevel(logging.DEBUG)

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter(fmt))

    file_handler = RotatingFileHandler(
        config.LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(fmt))

    logger.addHandler(console)
    logger.addHandler(file_handler)
    return logger


# ---------------------------------------------------------------------------
# Classe principale
# ---------------------------------------------------------------------------

class TradingBot:
    def __init__(self):
        self.logger = setup_logging()
        self.running = False
        self.exchange: ccxt.Exchange = self._init_exchange()
        self.paper_trader = PaperTrader(
            initial_capital=config.INITIAL_CAPITAL,
            state_file=config.PAPER_STATE_FILE,
        )

    def _init_exchange(self) -> ccxt.Exchange:
        params: dict = {"enableRateLimit": True}

        if config.TESTNET:
            # Testnet Binance : argent fictif, ordres réels sur testnet.binance.vision
            if not config.BINANCE_TESTNET_API_KEY or not config.BINANCE_TESTNET_SECRET_KEY:
                raise ValueError(
                    "BINANCE_TESTNET_API_KEY et BINANCE_TESTNET_SECRET_KEY requis en mode testnet.\n"
                    "Obtenez des clés gratuites sur : https://testnet.binance.vision"
                )
            params["apiKey"] = config.BINANCE_TESTNET_API_KEY
            params["secret"] = config.BINANCE_TESTNET_SECRET_KEY
        elif not config.PAPER_TRADING:
            # Production : argent réel
            if not config.BINANCE_API_KEY or not config.BINANCE_SECRET_KEY:
                raise ValueError("BINANCE_API_KEY et BINANCE_SECRET_KEY requis en mode réel")
            params["apiKey"] = config.BINANCE_API_KEY
            params["secret"] = config.BINANCE_SECRET_KEY

        exchange = ccxt.binance(params)

        if config.TESTNET:
            exchange.set_sandbox_mode(True)
            self.logger.info("Mode TESTNET activé → %s", exchange.urls["api"]["public"][:50])

        try:
            exchange.load_markets()
            if config.PAPER_TRADING:
                mode = "PAPER TRADING (local)"
            elif config.TESTNET:
                mode = "TESTNET Binance (argent fictif)"
            else:
                mode = "PRODUCTION Binance (argent RÉEL)"
            self.logger.info("Connexion Binance établie. Mode: %s", mode)
        except ccxt.NetworkError as e:
            self.logger.error("Impossible de se connecter à Binance: %s", e)
            raise
        return exchange

    # ------------------------------------------------------------------
    # Récupération de données
    # ------------------------------------------------------------------

    async def _fetch_ohlcv(self, symbol: str) -> pd.DataFrame | None:
        for attempt in range(3):
            try:
                raw = self.exchange.fetch_ohlcv(
                    symbol, config.TIMEFRAME, limit=config.CANDLE_LIMIT
                )
                df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
                df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
                return df
            except (ccxt.NetworkError, ccxt.ExchangeNotAvailable) as e:
                wait = 2 ** attempt
                self.logger.warning("OHLCV %s tentative %d/3 échouée: %s — attente %ds", symbol, attempt + 1, e, wait)
                await asyncio.sleep(wait)
        return None

    async def _fetch_prices(self) -> dict[str, float]:
        prices: dict[str, float] = {}
        for symbol in config.TRADING_PAIRS:
            try:
                ticker = self.exchange.fetch_ticker(symbol)
                if ticker.get("last"):
                    prices[symbol] = float(ticker["last"])
            except Exception as e:
                self.logger.warning("Impossible de récupérer le prix de %s: %s", symbol, e)
        return prices

    # ------------------------------------------------------------------
    # Boucle principale
    # ------------------------------------------------------------------

    async def run_cycle(self) -> None:
        # 1. Prix actuels pour la surveillance SL/TP
        prices = await self._fetch_prices()
        if prices:
            closed = self.paper_trader.update_positions(prices)
            if closed:
                self.logger.info("%d position(s) fermée(s) ce cycle", len(closed))

        # 2. Analyse de chaque paire
        open_symbols = {p.symbol for p in self.paper_trader.get_open_positions()}

        for symbol in config.TRADING_PAIRS:
            if symbol in open_symbols:
                self.logger.debug("Position déjà ouverte sur %s — analyse ignorée", symbol)
                continue

            df = await self._fetch_ohlcv(symbol)
            if df is None or len(df) < 40:
                self.logger.warning("Données insuffisantes pour %s", symbol)
                continue

            try:
                signal = generate_signal(df)
            except ValueError as e:
                self.logger.debug("Signal %s ignoré: %s", symbol, e)
                continue

            current_price = prices.get(symbol, float(df.iloc[-1]["close"]))

            self.logger.debug(
                "%s → signal=%s | RSI=%.1f | raison=%s",
                symbol,
                signal.signal_type.value,
                signal.rsi,
                signal.reason,
            )

            if signal.signal_type == SignalType.HOLD:
                continue

            params = calculate_position(signal, symbol, self.paper_trader.get_balance(), current_price)
            if params is None:
                self.logger.debug("Paramètres de trade non calculables pour %s", symbol)
                continue

            if config.PAPER_TRADING:
                self.paper_trader.open_position(params)
            else:
                # Testnet ou production : ordre réel envoyé à Binance
                await self._place_live_order(params)
                # Suivi en paper aussi pour le P&L local
                self.paper_trader.open_position(params)

        # 3. Résumé P&L
        summary = self.paper_trader.get_pnl_summary()
        self.logger.info(
            "Solde=%.2f USDT | P&L=%.2f USDT (%.2f%%) | Trades=%d | Win rate=%.0f%%",
            summary["current_balance"],
            summary["total_pnl"],
            summary["total_pnl_pct"],
            summary["total_trades"],
            summary["win_rate"] * 100,
        )

    async def _place_live_order(self, params) -> None:
        """Place un ordre réel sur Binance (testnet ou production)."""
        mode_label = "TESTNET" if config.TESTNET else "LIVE"
        try:
            order = self.exchange.create_market_order(
                symbol=params.symbol,
                side="buy" if params.direction == "long" else "sell",
                amount=params.position_size,
            )
            filled_price = (
                order.get("average")
                or order.get("price")
                or params.entry_price
            )
            self.logger.info(
                "[%s ORDER ✓] %s %s | id=%s | prix_exécuté=%.4f | taille=%.6f | valeur=%.2f USDT",
                mode_label,
                params.direction.upper(),
                params.symbol,
                order.get("id", "N/A"),
                filled_price,
                params.position_size,
                params.position_value,
            )
        except ccxt.InsufficientFunds as e:
            self.logger.error("[%s] Fonds insuffisants pour %s: %s", mode_label, params.symbol, e)
        except ccxt.ExchangeError as e:
            self.logger.error("[%s] Erreur exchange pour %s: %s", mode_label, params.symbol, e)

    # ------------------------------------------------------------------
    # Démarrage / Arrêt
    # ------------------------------------------------------------------

    async def run(self) -> None:
        self.running = True
        if config.PAPER_TRADING:
            mode = "PAPER TRADING (simulation locale)"
        elif config.TESTNET:
            mode = "TESTNET Binance — argent fictif"
        else:
            mode = "⚠️  PRODUCTION Binance — ARGENT RÉEL"
        self.logger.info("=" * 60)
        self.logger.info("Bot démarré — %s", mode)
        self.logger.info("Capital initial: %.2f USDT", config.INITIAL_CAPITAL)
        self.logger.info("Paires: %s", ", ".join(config.TRADING_PAIRS))
        self.logger.info("Timeframe: %s | Intervalle: %ds", config.TIMEFRAME, config.POLL_INTERVAL_SEC)
        self.logger.info("=" * 60)

        while self.running:
            try:
                await self.run_cycle()
            except ccxt.AuthenticationError:
                self.logger.critical("Authentification échouée — vérifiez vos clés API. Arrêt.")
                self.running = False
                break
            except ccxt.RateLimitExceeded:
                self.logger.warning("Rate limit atteint — pause 60s")
                await asyncio.sleep(60)
                continue
            except ccxt.NetworkError as e:
                self.logger.warning("Erreur réseau: %s — reprise dans 30s", e)
            except Exception as e:
                self.logger.error("Erreur inattendue: %s", e, exc_info=True)

            if self.running:
                await asyncio.sleep(config.POLL_INTERVAL_SEC)

        self.logger.info("Bot arrêté proprement.")
        self.paper_trader.save_state()

    def stop(self) -> None:
        self.logger.info("Signal d'arrêt reçu...")
        self.running = False


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

async def _main() -> None:
    bot = TradingBot()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, bot.stop)

    await bot.run()


if __name__ == "__main__":
    asyncio.run(_main())
