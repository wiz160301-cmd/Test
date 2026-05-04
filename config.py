import os
from dotenv import load_dotenv

load_dotenv()

# --- Secrets (ne jamais hardcoder) ---
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_SECRET_KEY = os.getenv("BINANCE_SECRET_KEY", "")

# --- Mode paper trading (défaut sécurisé) ---
PAPER_TRADING = os.getenv("PAPER_TRADING", "true").lower() == "true"

# --- Exchange ---
EXCHANGE_ID = "binance"
TRADING_PAIRS = [
    p.strip()
    for p in os.getenv("TRADING_PAIRS", "BTC/USDT,ETH/USDT,BNB/USDT").split(",")
]
TIMEFRAME = os.getenv("TIMEFRAME", "5m")
CANDLE_LIMIT = 100

# --- Capital et risque ---
INITIAL_CAPITAL = float(os.getenv("INITIAL_CAPITAL", "1000.0"))
RISK_PER_TRADE_PCT = float(os.getenv("RISK_PER_TRADE_PCT", "0.02"))  # 2% par trade
STOP_LOSS_PCT = float(os.getenv("STOP_LOSS_PCT", "0.01"))            # SL à 1%
TP_ATR_MULTIPLIER = float(os.getenv("TP_ATR_MULTIPLIER", "1.5"))     # TP min = 1.5× ATR
TP_ATR_MAX = float(os.getenv("TP_ATR_MAX", "2.0"))                   # TP max = 2× ATR
SLIPPAGE_PCT = 0.001                                                   # 0.1% frais taker Binance

# --- Indicateurs ---
RSI_PERIOD = 14
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
BB_PERIOD = 20
BB_STD = 2.0
ATR_PERIOD = 14

# --- Filtre de réactivité 48h ---
HIGH_REACTIVITY_CANDLES = 576   # 48h × 12 bougies/h en 5m
BASELINE_CANDLES = 8640         # 30 jours en 5m (utilisé comme référence ATR)

# --- Timing ---
POLL_INTERVAL_SEC = 30

# --- Fichiers ---
LOG_FILE = os.getenv("LOG_FILE", "trading_bot.log")
PAPER_STATE_FILE = os.getenv("PAPER_STATE_FILE", "paper_state.json")
