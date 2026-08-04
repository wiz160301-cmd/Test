const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export interface AuthResponse {
  access_token: string;
  role: "client" | "technician";
  user_id: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Identifiants invalides");
  return res.json();
}

export interface RemoteSession {
  id: string;
  status: "pending" | "active" | "ended";
  consent_given: boolean;
  technician_user_id: string | null;
  paid: boolean;
}

export async function listPendingSessions(): Promise<RemoteSession[]> {
  const res = await fetch(`${BACKEND_URL}/api/sessions/pending`);
  if (!res.ok) throw new Error(`Failed to list pending sessions: ${res.status}`);
  return res.json();
}

export async function listActiveSessions(technicianUserId: string): Promise<RemoteSession[]> {
  const res = await fetch(
    `${BACKEND_URL}/api/sessions/active?technician_user_id=${encodeURIComponent(technicianUserId)}`
  );
  if (!res.ok) throw new Error(`Failed to list active sessions: ${res.status}`);
  return res.json();
}

export async function claimSession(sessionId: string, technicianUserId: string): Promise<RemoteSession> {
  const res = await fetch(
    `${BACKEND_URL}/api/sessions/${sessionId}/claim?technician_user_id=${encodeURIComponent(technicianUserId)}`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error(`Failed to claim session: ${res.status}`);
  return res.json();
}

export async function endSession(sessionId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/end?actor=technician`, { method: "POST" });
}

export interface AuditEntry {
  session_id: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: string;
  prev_hash: string;
  entry_hash: string;
}

export async function getAuditTrail(
  sessionId: string
): Promise<{ entries: AuditEntry[]; chain_valid: boolean }> {
  const res = await fetch(`${BACKEND_URL}/api/audit/${sessionId}`);
  if (!res.ok) throw new Error(`Failed to fetch audit trail: ${res.status}`);
  return res.json();
}
