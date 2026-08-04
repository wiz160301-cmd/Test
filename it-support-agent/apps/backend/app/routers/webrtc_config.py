from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/webrtc", tags=["webrtc"])


@router.get("/ice-servers")
def get_ice_servers() -> dict:
    servers = [{"urls": url.strip()} for url in settings.stun_urls.split(",") if url.strip()]

    if settings.turn_url:
        servers.append(
            {
                "urls": settings.turn_url,
                "username": settings.turn_username,
                "credential": settings.turn_credential,
            }
        )

    return {"iceServers": servers}
