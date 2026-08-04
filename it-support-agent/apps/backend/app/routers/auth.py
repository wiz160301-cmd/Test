from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.security import create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    plan: str = "free"


@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest) -> LoginResponse:
    """Stub d'authentification pour le prototype.

    À remplacer par une vérification réelle contre la table users (hash de
    mot de passe via passlib) avant toute mise en production.
    """
    if not request.email or not request.password:
        raise HTTPException(status_code=400, detail="email et password requis")

    token = create_access_token(subject=request.email)
    return LoginResponse(access_token=token)
