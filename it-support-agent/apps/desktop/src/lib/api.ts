const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SystemInfo {
  os: string;
  os_version: string;
  cpu: string;
  memory_total_mb: number;
  memory_used_mb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  network_connected: boolean;
}

export interface ChatResponse {
  reply: string;
  suggested_script_ids: string[];
}

export async function sendChatMessage(
  sessionId: string,
  lang: string,
  messages: ChatMessage[],
  systemInfo: SystemInfo | null
): Promise<ChatResponse> {
  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      lang,
      messages,
      system_info: systemInfo,
    }),
  });
  if (!res.ok) {
    throw new Error(`Chat request failed: ${res.status}`);
  }
  return res.json();
}

export interface ScriptEvaluation {
  allowed: boolean;
  requires_confirmation: boolean;
  reason: string;
}

export async function evaluateScript(
  sessionId: string,
  scriptId: string,
  userConfirmed: boolean
): Promise<ScriptEvaluation> {
  const res = await fetch(`${BACKEND_URL}/api/scripts/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      script_id: scriptId,
      user_confirmed: userConfirmed,
    }),
  });
  if (res.status === 403) {
    const body = await res.json();
    return {
      allowed: false,
      requires_confirmation: body.detail?.requires_confirmation ?? true,
      reason: body.detail?.reason ?? "Refused",
    };
  }
  if (!res.ok) {
    throw new Error(`Script evaluation failed: ${res.status}`);
  }
  return res.json();
}

export interface ScriptCatalogEntry {
  category: string;
  risk_level: "safe" | "moderate" | "destructive";
  reversible: boolean;
  auto_approved: boolean;
}

export async function getScriptCatalog(): Promise<Record<string, ScriptCatalogEntry>> {
  const res = await fetch(`${BACKEND_URL}/api/scripts/catalog`);
  if (!res.ok) {
    throw new Error(`Catalog request failed: ${res.status}`);
  }
  return res.json();
}

export interface RemoteSession {
  id: string;
  status: "pending" | "active" | "ended";
  consent_given: boolean;
  technician_user_id: string | null;
  paid: boolean;
}

export async function createSession(): Promise<RemoteSession> {
  const res = await fetch(`${BACKEND_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  return res.json();
}

export async function getSession(sessionId: string): Promise<RemoteSession> {
  const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`);
  return res.json();
}

export async function endSessionOnBackend(sessionId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/end`, { method: "POST" });
}

export async function giveRemoteControlConsent(sessionId: string): Promise<RemoteSession> {
  const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/consent`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Consent failed: ${res.status}`);
  }
  return res.json();
}

export interface CheckoutResponse {
  checkout_url: string;
  payment_id: string;
}

export async function createCheckoutSession(sessionId: string): Promise<CheckoutResponse> {
  const res = await fetch(`${BACKEND_URL}/api/payments/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Checkout failed: ${res.status}`);
  }
  return res.json();
}
