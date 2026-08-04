from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import audit, auth, chat, scripts

app = FastAPI(
    title="IT Support Agent API",
    description="Backend cloud léger : auth, proxy Claude, audit log, facturation.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["tauri://localhost", "http://localhost:1420"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(scripts.router)
app.include_router(audit.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
