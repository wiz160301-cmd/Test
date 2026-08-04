from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.session import init_db
from app.routers import audit, auth, chat, payments, recordings, scripts, sessions, signaling, webrtc_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="IT Support Agent API",
    description="Backend cloud léger : auth, proxy Claude, audit log, facturation, signaling WebRTC.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["tauri://localhost", "http://localhost:1420", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(scripts.router)
app.include_router(audit.router)
app.include_router(sessions.router)
app.include_router(signaling.router)
app.include_router(webrtc_config.router)
app.include_router(payments.router)
app.include_router(recordings.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
