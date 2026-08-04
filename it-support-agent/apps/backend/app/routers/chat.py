from fastapi import APIRouter
from pydantic import BaseModel

from anthropic import Anthropic

from app.core.config import settings
from app.core.guardrails import SCRIPT_CATALOG

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPTS = {
    "en": (
        "You are an IT support diagnostic assistant embedded in a desktop app. "
        "You help diagnose hardware, network, OS and software issues from the "
        "system information provided to you. You NEVER execute a remediation "
        "script yourself: you may only recommend one from the approved catalog "
        "by name, and the app will ask the user to confirm before running it. "
        "Be concise, non-technical when possible, and always explain WHY you "
        "recommend an action before naming it."
    ),
    "fr": (
        "Tu es un assistant IA de diagnostic informatique intégré à une "
        "application desktop. Tu aides à diagnostiquer des problèmes matériel, "
        "réseau, OS et logiciels à partir des informations système fournies. "
        "Tu n'exécutes JAMAIS toi-même un script de remédiation : tu peux "
        "seulement en recommander un du catalogue approuvé par son nom, et "
        "l'application demandera confirmation à l'utilisateur avant de "
        "l'exécuter. Sois concis, accessible aux non-techniciens, et explique "
        "toujours POURQUOI avant de nommer une action."
    ),
    "es": (
        "Eres un asistente de IA de diagnóstico informático integrado en una "
        "aplicación de escritorio. Ayudas a diagnosticar problemas de "
        "hardware, red, sistema operativo y software a partir de la "
        "información del sistema proporcionada. NUNCA ejecutas tú mismo un "
        "script de remediación: solo puedes recomendar uno del catálogo "
        "aprobado por su nombre, y la aplicación pedirá confirmación al "
        "usuario antes de ejecutarlo. Sé conciso, accesible para no técnicos, "
        "y explica siempre POR QUÉ antes de nombrar una acción."
    ),
}


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    session_id: str
    lang: str = "en"
    messages: list[ChatMessage]
    system_info: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    suggested_script_ids: list[str] = []


def _build_system_prompt(lang: str, system_info: dict | None) -> str:
    base = SYSTEM_PROMPTS.get(lang, SYSTEM_PROMPTS["en"])
    catalog_summary = ", ".join(SCRIPT_CATALOG.keys())
    prompt = f"{base}\n\nApproved remediation script catalog: {catalog_summary}."
    if system_info:
        prompt += f"\n\nCurrent system info (JSON): {system_info}"
    return prompt


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    client = Anthropic(api_key=settings.anthropic_api_key)

    response = client.messages.create(
        model=settings.claude_model,
        max_tokens=1024,
        system=_build_system_prompt(request.lang, request.system_info),
        messages=[{"role": m.role, "content": m.content} for m in request.messages],
    )

    reply_text = "".join(
        block.text for block in response.content if block.type == "text"
    )

    suggested = [sid for sid in SCRIPT_CATALOG if sid in reply_text]

    return ChatResponse(reply=reply_text, suggested_script_ids=suggested)
