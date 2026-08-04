from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-5"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    database_url: str = "sqlite:///./dev.db"

    freemium_enabled: bool = True
    intervention_price_cents: int = 4900
    intervention_currency: str = "eur"

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    frontend_success_url: str = "http://localhost:1420/payment/success"
    frontend_cancel_url: str = "http://localhost:1420/payment/cancel"

    # TURN/STUN pour le WebRTC (phase 2 remote control). STUN public par
    # défaut en dev ; un serveur TURN dédié (coturn ou fournisseur managé)
    # est requis en production pour les réseaux avec NAT symétrique/pare-feu
    # strict que le P2P direct ne peut pas traverser.
    stun_urls: str = "stun:stun.l.google.com:19302"
    turn_url: str = ""
    turn_username: str = ""
    turn_credential: str = ""


settings = Settings()
