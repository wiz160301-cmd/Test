from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import User, UserRole

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class RegisterRequest(BaseModel):
    email: str
    password: str
    role: UserRole = UserRole.CLIENT


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str


@router.post("/register", response_model=AuthResponse)
def register(request: RegisterRequest, db: DBSession = Depends(get_db)) -> AuthResponse:
    if db.query(User).filter(User.email == request.email).first():
        raise HTTPException(status_code=409, detail="Un compte existe déjà avec cet email")

    user = User(
        email=request.email,
        hashed_password=pwd_context.hash(request.password),
        role=request.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.id)
    return AuthResponse(access_token=token, role=user.role, user_id=user.id)


@router.post("/login", response_model=AuthResponse)
def login(request: LoginRequest, db: DBSession = Depends(get_db)) -> AuthResponse:
    user = db.query(User).filter(User.email == request.email).first()
    if not user or not pwd_context.verify(request.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Identifiants invalides")

    token = create_access_token(subject=user.id)
    return AuthResponse(access_token=token, role=user.role, user_id=user.id)
