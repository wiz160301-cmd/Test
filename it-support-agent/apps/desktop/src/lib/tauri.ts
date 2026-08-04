import { invoke } from "@tauri-apps/api/core";
import type { SystemInfo } from "./api";

export type RiskLevel = "Safe" | "Moderate" | "Destructive";

export interface Decision {
  allowed: boolean;
  requires_confirmation: boolean;
  reason: string;
  risk_level: RiskLevel | null;
  reversible: boolean | null;
}

export interface ExecutionResult {
  decision: Decision;
  executed: boolean;
  output: string;
}

export function collectSystemInfo(): Promise<SystemInfo> {
  return invoke("collect_system_info");
}

export function evaluateScriptLocal(
  scriptId: string,
  userConfirmed: boolean
): Promise<Decision> {
  return invoke("evaluate_script", { scriptId, userConfirmed });
}

export function executeScript(
  sessionId: string,
  actor: string,
  scriptId: string,
  userConfirmed: boolean
): Promise<ExecutionResult> {
  return invoke("execute_script", {
    sessionId,
    actor,
    scriptId,
    userConfirmed,
  });
}

export function appendAuditEntry(
  sessionId: string,
  actor: string,
  action: string,
  details: unknown
): Promise<unknown> {
  return invoke("append_audit_entry", {
    sessionId,
    actor,
    action,
    details,
  });
}
