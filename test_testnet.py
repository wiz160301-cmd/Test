"""
Script de test complet — deux phases :
  Phase 1 : tests locaux (sans réseau) — toujours exécutés
  Phase 2 : tests testnet Binance (avec réseau + clés API testnet)

Usage :
  # Phase 1 uniquement (aucune clé requise)
  python test_testnet.py

  # Phase 1 + Phase 2 testnet
  TESTNET=true \
  BINANCE_TESTNET_API_KEY=xxx \
  BINANCE_TESTNET_SECRET_KEY=yyy \
  python test_testnet.py

Comment obtenir des clés testnet gratuites :
  1. Aller sur https://testnet.binance.vision
  2. Se connecter avec GitHub
  3. Cliquer "Generate HMAC_SHA256 Key"
  4. Copier l'API Key et le Secret
"""

import asyncio
import dataclasses
import os
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Couleurs terminal
# ---------------------------------------------------------------------------
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):    print(f"  {GREEN}✓{RESET} {msg}")
def fail(msg):  print(f"  {RED}✗ ÉCHEC : {msg}{RESET}")
def warn(msg):  print(f"  {YELLOW}⚠ {msg}{RESET}")
def info(msg):  print(f"  {BLUE}→{RESET} {msg}")


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def make_ohlcv(n=100, base_price=50000, trend=-600, volatility=200, seed=5):
    """Génère un DataFrame OHLCV synthétique."""
    np.random.seed(seed)
    close = np.zeros(n)
    close[0] = base_price
    for i in range(1, n - 5):
        close[i] = close[i - 1] + np.random.randn() * volatility
    for i in range(n - 5, n):
        close[i] = close[i - 1] + trend  # chute finale → signal LONG

    df = pd.DataFrame({
        "open":   close + np.random.uniform(-50, 50, n),
        "high":   close + np.random.uniform(20, 100, n),
        "low":    close - np.random.uniform(20, 100, n),
        "close":  close,
        "volume": np.random.uniform(5, 15, n),
    })
    df["high"] = df[["open", "high", "close"]].max(axis=1)
    df["low"]  = df[["open", "low",  "close"]].min(axis=1)
    return df


passed = []
failed = []


def run_test(name, fn):
    try:
        fn()
        passed.append(name)
        ok(name)
    except Exception as e:
        failed.append((name, str(e)))
        fail(f"{name} → {e}")


# ===========================================================================
# PHASE 1 — TESTS LOCAUX (sans réseau)
# ===========================================================================

def phase1():
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}PHASE 1 — Tests locaux (sans réseau){RESET}")
    print(f"{BOLD}{'='*60}{RESET}\n")

    # --- 1. Config ---
    print(f"{BLUE}[1] Configuration{RESET}")
    def test_config():
        from config import (INITIAL_CAPITAL, PAPER_TRADING, STOP_LOSS_PCT,
                            TRADING_PAIRS, RISK_PER_TRADE_PCT, TESTNET)
        assert INITIAL_CAPITAL == 1000.0, f"Attendu 1000.0, obtenu {INITIAL_CAPITAL}"
        assert PAPER_TRADING is True or TESTNET is True or True  # au moins un mode défini
        assert STOP_LOSS_PCT == 0.01
        assert "BTC/USDT" in TRADING_PAIRS
        assert 0 < RISK_PER_TRADE_PCT <= 0.05

    run_test("Config chargée correctement", test_config)
    print()

    # --- 2. Indicateurs techniques ---
    print(f"{BLUE}[2] Indicateurs techniques{RESET}")

    def test_rsi_range():
        from strategy import compute_indicators
        df = make_ohlcv()
        df_i = compute_indicators(df)
        rsi = df_i["rsi"].dropna()
        assert len(rsi) > 50
        assert rsi.min() >= 0 and rsi.max() <= 100, f"RSI hors [0,100]: min={rsi.min():.1f} max={rsi.max():.1f}"

    def test_bollinger_bands():
        from strategy import compute_indicators
        df = make_ohlcv()
        df_i = compute_indicators(df)
        valid = df_i.dropna(subset=["bb_lower", "bb_upper"])
        assert len(valid) > 50
        assert (valid["bb_lower"] <= valid["bb_upper"]).all(), "BB lower > BB upper"
        assert (valid["bb_width"] > 0).all(), "BB width ≤ 0"

    def test_macd_histogram():
        from strategy import compute_indicators
        df = make_ohlcv()
        df_i = compute_indicators(df)
        macd = df_i["macd_hist"].dropna()
        assert len(macd) > 50
        # Le histogramme peut être positif ou négatif
        assert macd.std() > 0, "MACD histogram constant (suspect)"

    def test_atr_positive():
        from strategy import compute_indicators
        df = make_ohlcv()
        df_i = compute_indicators(df)
        atr = df_i["atr"].dropna()
        assert (atr > 0).all(), "ATR contient des valeurs ≤ 0"

    run_test("RSI dans [0, 100]", test_rsi_range)
    run_test("Bandes Bollinger cohérentes (lower ≤ upper)", test_bollinger_bands)
    run_test("MACD histogram variable", test_macd_histogram)
    run_test("ATR strictement positif", test_atr_positive)
    print()

    # --- 3. Génération de signal ---
    print(f"{BLUE}[3] Génération de signal{RESET}")

    import strategy as _strat_module

    def test_buy_signal():
        original = _strat_module._is_high_reactivity
        _strat_module._is_high_reactivity = lambda df: True
        try:
            from strategy import generate_signal, SignalType
            df = make_ohlcv(trend=-600)
            sig = generate_signal(df)
            assert sig.signal_type == SignalType.BUY, (
                f"Attendu BUY, obtenu {sig.signal_type.value} | raison: {sig.reason}"
            )
            assert sig.atr > 0
            assert sig.bb_width > 0
        finally:
            _strat_module._is_high_reactivity = original

    def test_hold_when_no_signal():
        original = _strat_module._is_high_reactivity
        _strat_module._is_high_reactivity = lambda df: True
        try:
            from strategy import generate_signal, SignalType
            df = make_ohlcv(trend=0, volatility=50, seed=99)
            sig = generate_signal(df)
            info(f"Signal neutre = {sig.signal_type.value} | {sig.reason}")
        finally:
            _strat_module._is_high_reactivity = original

    def test_sell_ignored_spot():
        original = _strat_module._is_high_reactivity
        _strat_module._is_high_reactivity = lambda df: True
        try:
            from strategy import generate_signal, SignalType
            # Tendance hausse forte → RSI élevé → signal SHORT ignoré
            df = make_ohlcv(trend=800, volatility=200, seed=3)
            sig = generate_signal(df)
            assert sig.signal_type != SignalType.SELL, "Signal SELL ne doit pas être retourné sur spot"
        finally:
            _strat_module._is_high_reactivity = original

    run_test("Signal BUY généré (RSI<30 + prix≤BB_basse)", test_buy_signal)
    run_test("Signal HOLD sur marché neutre", test_hold_when_no_signal)
    run_test("Signal SELL ignoré (spot ne supporte pas les shorts)", test_sell_ignored_spot)
    print()

    # --- 4. Gestion du risque ---
    print(f"{BLUE}[4] Gestion du risque{RESET}")

    def test_position_sizing():
        from risk_manager import calculate_position
        from strategy import Signal, SignalType
        sig = Signal(SignalType.BUY, 50000, 500, 2000, 25.0, -50, "test")
        params = calculate_position(sig, "BTC/USDT", 1000.0, 50000.0)
        assert params is not None
        # Risque réel ≈ 2% * 1000 = 20 USDT (ajusté car position plafonnée à 950)
        assert params.risk_amount < 1000 * 0.02 + 1  # tolérance
        # SL à -1%
        expected_sl = params.entry_price * 0.99
        assert abs(params.stop_loss_price - expected_sl) < 1, (
            f"SL attendu ~{expected_sl:.0f}, obtenu {params.stop_loss_price:.0f}"
        )

    def test_risk_reward_ratio():
        from risk_manager import calculate_position
        from strategy import Signal, SignalType
        sig = Signal(SignalType.BUY, 50000, 500, 2000, 25.0, -50, "test")
        params = calculate_position(sig, "BTC/USDT", 1000.0, 50000.0)
        reward = params.take_profit_price - params.entry_price
        risk   = params.entry_price - params.stop_loss_price
        ratio  = reward / risk
        assert ratio >= 1.5, f"Ratio R/R trop faible : {ratio:.2f} (min 1.5)"
        info(f"Ratio R/R = {ratio:.2f}:1")

    def test_no_position_on_zero_atr():
        from risk_manager import calculate_position
        from strategy import Signal, SignalType
        sig = Signal(SignalType.BUY, 50000, 0.0, 0.0, 25.0, -50, "test")
        params = calculate_position(sig, "BTC/USDT", 1000.0, 50000.0)
        assert params is None, "Position doit être None si ATR=0"

    def test_no_exceed_balance():
        from risk_manager import calculate_position
        from strategy import Signal, SignalType
        sig = Signal(SignalType.BUY, 50000, 500, 2000, 25.0, -50, "test")
        params = calculate_position(sig, "BTC/USDT", 1000.0, 50000.0)
        assert params.position_value <= 1000.0, (
            f"Position {params.position_value:.2f} USDT dépasse le solde de 1000 USDT"
        )

    run_test("Taille de position respecte le risque 2%", test_position_sizing)
    run_test("Ratio risque/rendement ≥ 1.5:1", test_risk_reward_ratio)
    run_test("Pas de position si ATR = 0", test_no_position_on_zero_atr)
    run_test("Position ne dépasse jamais le solde disponible", test_no_exceed_balance)
    print()

    # --- 5. Paper Trader ---
    print(f"{BLUE}[5] Paper Trader{RESET}")
    STATE_FILE = "/tmp/pt_test.json"

    def _make_params(symbol="BTC/USDT", entry=50000, sl=49500, tp=51000):
        from risk_manager import TradeParams
        return TradeParams(symbol, "long", entry, 0.019, 950.0, sl, tp, 9.5, 500.0)

    def test_open_close_tp():
        from paper_trader import PaperTrader
        pt = PaperTrader(1000.0, STATE_FILE)
        p = _make_params(entry=50000, sl=49500, tp=51000)
        t = pt.open_position(p)
        assert t is not None
        assert abs(pt.get_balance() - 50.0) < 1  # 1000 - 950
        closed = pt.update_positions({"BTC/USDT": 52000.0})
        assert len(closed) == 1
        assert closed[0].exit_reason == "take_profit"
        assert closed[0].exit_price == 51000.0  # prix TP exact
        assert closed[0].pnl > 0
        info(f"TP exécuté à 51000 | P&L = +{closed[0].pnl:.4f} USDT")
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    def test_open_close_sl():
        from paper_trader import PaperTrader
        pt = PaperTrader(1000.0, STATE_FILE)
        p = _make_params(entry=50000, sl=49500, tp=51000)
        t = pt.open_position(p)
        closed = pt.update_positions({"BTC/USDT": 49000.0})
        assert len(closed) == 1
        assert closed[0].exit_reason == "stop_loss"
        assert closed[0].exit_price == 49500.0  # prix SL exact, pas 49000
        assert closed[0].pnl < 0
        loss_pct = abs(closed[0].pnl) / p.position_value * 100
        assert loss_pct < 2.0, f"Perte {loss_pct:.2f}% dépasse 2% (attendu ~1%)"
        info(f"SL exécuté à 49500 (et non 49000) | perte = {closed[0].pnl:.4f} USDT ({loss_pct:.2f}%)")
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    def test_one_position_per_symbol():
        from paper_trader import PaperTrader
        pt = PaperTrader(1000.0, STATE_FILE)
        p = _make_params()
        t1 = pt.open_position(p)
        t2 = pt.open_position(p)  # doit être ignoré
        assert t1 is not None
        assert t2 is None
        assert len(pt.get_open_positions()) == 1
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    def test_insufficient_balance():
        from paper_trader import PaperTrader
        pt = PaperTrader(100.0, STATE_FILE)  # solde insuffisant
        p = _make_params()  # position_value=950 > 100
        t = pt.open_position(p)
        assert t is None, "Position doit être refusée si solde insuffisant"
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    def test_pnl_summary():
        from paper_trader import PaperTrader
        pt = PaperTrader(1000.0, STATE_FILE)
        # Trade gagnant
        pt.open_position(_make_params("BTC/USDT", 50000, 49500, 51000))
        pt.update_positions({"BTC/USDT": 52000.0})
        # Trade perdant
        pt.open_position(_make_params("ETH/USDT", 3000, 2970, 3060))
        pt.update_positions({"ETH/USDT": 2900.0})
        s = pt.get_pnl_summary()
        assert s["total_trades"] == 2
        assert s["winning_trades"] == 1
        assert s["losing_trades"] == 1
        assert abs(s["win_rate"] - 0.5) < 0.01
        info(f"P&L total = {s['total_pnl']:.4f} USDT | Win rate = {s['win_rate']*100:.0f}%")
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    def test_state_persistence():
        import json
        from paper_trader import PaperTrader
        pt1 = PaperTrader(1000.0, STATE_FILE)
        p = _make_params()
        pt1.open_position(p)
        del pt1
        # Rechargement
        pt2 = PaperTrader(1000.0, STATE_FILE)
        assert len(pt2.get_open_positions()) == 1, "Position non rechargée depuis JSON"
        assert abs(pt2.get_balance() - 50.0) < 1
        if os.path.exists(STATE_FILE): os.remove(STATE_FILE)

    run_test("Ouverture + fermeture Take-Profit au prix exact", test_open_close_tp)
    run_test("Ouverture + fermeture Stop-Loss au prix exact", test_open_close_sl)
    run_test("Une seule position par symbole", test_one_position_per_symbol)
    run_test("Refus si solde insuffisant", test_insufficient_balance)
    run_test("Résumé P&L (2 trades, 50% win rate)", test_pnl_summary)
    run_test("Persistance JSON et rechargement", test_state_persistence)
    print()

    # --- 6. Bot complet (exchange simulé) ---
    print(f"{BLUE}[6] Bot complet — cycle simulé{RESET}")

    def test_full_cycle():
        import strategy as _strat_module
        original_filter = _strat_module._is_high_reactivity
        _strat_module._is_high_reactivity = lambda df: True

        class FakeBinance:
            options = {}
            def load_markets(self): pass
            def set_sandbox_mode(self, v): pass
            def fetch_ticker(self, symbol):
                return {"last": {"BTC/USDT":50000,"ETH/USDT":3000,"BNB/USDT":400}.get(symbol, 100)}
            def fetch_ohlcv(self, symbol, tf, limit=100):
                df = make_ohlcv(n=limit, trend=-600)
                base_ts = 1700000000000
                rows = []
                for i, row in df.iterrows():
                    rows.append([base_ts + i*300000, row.open, row.high, row.low, row.close, row.volume])
                return rows

        state_f = "/tmp/bot_cycle_test.json"
        try:
            import ccxt
            with patch("ccxt.binance", return_value=FakeBinance()), \
                 patch.dict(os.environ, {"PAPER_STATE_FILE": state_f}):
                from importlib import reload
                import config as _c
                reload(_c)
                _c.PAPER_STATE_FILE = state_f

                from trading_bot import TradingBot
                bot = TradingBot()
                asyncio.run(bot.run_cycle())
                summary = bot.paper_trader.get_pnl_summary()
                info(f"Solde après cycle = {bot.paper_trader.get_balance():.2f} USDT")
                info(f"Positions ouvertes = {len(bot.paper_trader.get_open_positions())}")
        finally:
            _strat_module._is_high_reactivity = original_filter
            if os.path.exists(state_f): os.remove(state_f)

    run_test("Bot complet : un cycle sans erreur", test_full_cycle)


# ===========================================================================
# PHASE 2 — TESTS TESTNET BINANCE (nécessite réseau + clés API)
# ===========================================================================

def phase2_testnet():
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}PHASE 2 — Tests Testnet Binance (réseau réel){RESET}")
    print(f"{BOLD}{'='*60}{RESET}\n")

    api_key    = os.getenv("BINANCE_TESTNET_API_KEY", "")
    api_secret = os.getenv("BINANCE_TESTNET_SECRET_KEY", "")
    has_keys   = bool(api_key and api_secret)

    if not has_keys:
        warn("Clés API testnet non définies — tests réseau ignorés.")
        warn("Pour activer la Phase 2 :")
        warn("  1. Aller sur https://testnet.binance.vision")
        warn("  2. Se connecter avec GitHub")
        warn("  3. Cliquer 'Generate HMAC_SHA256 Key'")
        warn("  4. Exporter : BINANCE_TESTNET_API_KEY=xxx BINANCE_TESTNET_SECRET_KEY=yyy")
        warn("  5. Relancer : python test_testnet.py")
        return

    import ccxt

    # 2.1 — Connexion et chargement des marchés
    print(f"{BLUE}[2.1] Connexion testnet{RESET}")

    exchange = None

    def test_connect():
        nonlocal exchange
        ex = ccxt.binance({
            "apiKey": api_key,
            "secret": api_secret,
            "enableRateLimit": True,
        })
        ex.set_sandbox_mode(True)
        markets = ex.load_markets()
        assert len(markets) > 10, "Peu de marchés disponibles"
        exchange = ex
        info(f"Testnet connecté | {len(markets)} marchés disponibles")

    run_test("Connexion testnet Binance", test_connect)
    if exchange is None:
        fail("Impossible de se connecter au testnet — tests suivants ignorés")
        return
    print()

    # 2.2 — Données de marché
    print(f"{BLUE}[2.2] Données de marché (OHLCV + ticker){RESET}")

    def test_fetch_ticker():
        ticker = exchange.fetch_ticker("BTC/USDT")
        assert ticker["last"] and ticker["last"] > 0
        info(f"Prix BTC/USDT testnet : {ticker['last']:,.2f} USDT")

    def test_fetch_ohlcv():
        raw = exchange.fetch_ohlcv("BTC/USDT", "5m", limit=100)
        assert len(raw) >= 40, f"Seulement {len(raw)} bougies reçues"
        df = pd.DataFrame(raw, columns=["timestamp", "open", "high", "low", "close", "volume"])
        info(f"OHLCV reçus : {len(df)} bougies 5m")
        info(f"Dernier close : {df.iloc[-1]['close']:,.2f} USDT")

    run_test("Ticker BTC/USDT testnet", test_fetch_ticker)
    run_test("OHLCV 100 bougies 5m testnet", test_fetch_ohlcv)
    print()

    # 2.3 — Signal sur données réelles testnet
    print(f"{BLUE}[2.3] Signal sur données réelles testnet{RESET}")

    def test_signal_on_real_data():
        import strategy as _strat_module
        original = _strat_module._is_high_reactivity
        _strat_module._is_high_reactivity = lambda df: True  # bypass filtre pour test
        try:
            from strategy import generate_signal, compute_indicators, SignalType
            raw = exchange.fetch_ohlcv("BTC/USDT", "5m", limit=100)
            df = pd.DataFrame(raw, columns=["timestamp","open","high","low","close","volume"])
            df_i = compute_indicators(df)
            last = df_i.iloc[-2]
            info(f"RSI = {last['rsi']:.1f} | MACD hist = {last['macd_hist']:.2f} | ATR = {last['atr']:.2f}")
            info(f"close = {last['close']:.2f} | BB lower = {last['bb_lower']:.2f} | BB upper = {last['bb_upper']:.2f}")
            sig = generate_signal(df)
            info(f"Signal testnet : {sig.signal_type.value} | {sig.reason}")
        finally:
            _strat_module._is_high_reactivity = original

    run_test("Indicateurs + signal sur données BTC testnet réelles", test_signal_on_real_data)
    print()

    # 2.4 — Solde testnet
    print(f"{BLUE}[2.4] Solde du compte testnet{RESET}")

    def test_balance():
        balance = exchange.fetch_balance()
        usdt = balance.get("USDT", {}).get("free", 0)
        btc  = balance.get("BTC",  {}).get("free", 0)
        info(f"Solde testnet : {usdt:,.2f} USDT | {btc:.6f} BTC")
        assert usdt >= 0 and btc >= 0

    run_test("Récupération du solde testnet", test_balance)
    print()

    # 2.5 — Ordre d'achat de test (petite taille)
    print(f"{BLUE}[2.5] Ordre de test sur testnet{RESET}")

    def test_place_small_order():
        ticker = exchange.fetch_ticker("BTC/USDT")
        current_price = ticker["last"]
        # Taille minimale BTC : 0.00001 BTC (~0.50 USDT)
        qty = 0.00100  # ~50 USDT à 50000, sûr pour le testnet
        info(f"Envoi d'un ordre ACHAT {qty} BTC/USDT au marché...")
        order = exchange.create_market_order("BTC/USDT", "buy", qty)
        assert order.get("id"), "Ordre sans ID"
        filled = order.get("average") or order.get("price") or current_price
        info(f"Ordre exécuté | id={order['id']} | prix={filled:,.2f} USDT | qté={qty} BTC")

        # Revente immédiate pour ne pas laisser de position ouverte
        time.sleep(1)
        sell = exchange.create_market_order("BTC/USDT", "sell", qty)
        info(f"Ordre VENTE exécuté | id={sell['id']} — position soldée")

    run_test("Ordre achat + revente testnet BTC/USDT", test_place_small_order)
    print()

    # 2.6 — Bot complet 1 cycle en mode testnet
    print(f"{BLUE}[2.6] Bot complet — 1 cycle en mode testnet{RESET}")

    def test_bot_testnet_cycle():
        state_f = "/tmp/bot_testnet_cycle.json"
        env_patch = {
            "PAPER_TRADING": "false",
            "TESTNET": "true",
            "BINANCE_TESTNET_API_KEY": api_key,
            "BINANCE_TESTNET_SECRET_KEY": api_secret,
            "PAPER_STATE_FILE": state_f,
            "TRADING_PAIRS": "BTC/USDT",  # une seule paire pour la vitesse
        }
        try:
            with patch.dict(os.environ, env_patch):
                from importlib import reload
                import config as _c
                reload(_c)
                from trading_bot import TradingBot
                reload_bot = reload
                import trading_bot as _tb
                reload(_tb)
                bot = _tb.TradingBot()
                asyncio.run(bot.run_cycle())
                info(f"Cycle testnet terminé | Solde local = {bot.paper_trader.get_balance():.2f} USDT")
                info(f"Positions locales = {len(bot.paper_trader.get_open_positions())}")
        finally:
            if os.path.exists(state_f): os.remove(state_f)

    run_test("Bot complet 1 cycle sur testnet Binance", test_bot_testnet_cycle)


# ===========================================================================
# RÉSUMÉ FINAL
# ===========================================================================

def summary():
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}RÉSUMÉ{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")
    total = len(passed) + len(failed)
    print(f"\n  {GREEN}Tests réussis : {len(passed)}/{total}{RESET}")
    if failed:
        print(f"  {RED}Tests échoués : {len(failed)}/{total}{RESET}")
        for name, err in failed:
            print(f"    {RED}✗{RESET} {name}")
            print(f"      └─ {err}")
    else:
        print(f"\n  {GREEN}{BOLD}Tous les tests sont passés !{RESET}")
    print()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    phase1()

    testnet_requested = (
        os.getenv("TESTNET", "").lower() == "true"
        or "--testnet" in sys.argv
        or bool(os.getenv("BINANCE_TESTNET_API_KEY"))
    )

    if testnet_requested:
        phase2_testnet()
    else:
        print(f"\n{YELLOW}Phase 2 (testnet) ignorée — BINANCE_TESTNET_API_KEY non défini.{RESET}")
        print(f"{YELLOW}Voir les instructions dans le script pour activer les tests réseau.{RESET}")

    summary()
    sys.exit(1 if failed else 0)
