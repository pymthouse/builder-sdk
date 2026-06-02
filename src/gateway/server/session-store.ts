import { createHash, randomUUID } from "node:crypto";
import type { PaymentSession } from "./payment-session.js";

export type GatewaySessionRecord = {
  id: string;
  ownerTokenHash: string;
  manifestId: string;
  publishUrl: string;
  subscribeUrl: string;
  controlUrl?: string;
  mimeType: string;
  paymentSession: PaymentSession;
  orchestratorUrl: string;
  publishSeq: number;
  subscribeSeq: number;
  trickleCreated: boolean;
  /** First segment POST to orch includes Lp-Trickle-Reset. */
  trickleResetSent: boolean;
  paymentInterval?: ReturnType<typeof setInterval>;
  closed: boolean;
};

const SESSIONS_GLOBAL_KEY = Symbol.for("@pymthouse/builder-sdk/gateway-sessions");

function sessionsMap(): Map<string, GatewaySessionRecord> {
  const globalStore = globalThis as typeof globalThis & {
    [SESSIONS_GLOBAL_KEY]?: Map<string, GatewaySessionRecord>;
  };
  globalStore[SESSIONS_GLOBAL_KEY] ??= new Map();
  return globalStore[SESSIONS_GLOBAL_KEY];
}

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function createSessionId(): string {
  return randomUUID();
}

export function putSession(record: GatewaySessionRecord): void {
  sessionsMap().set(record.id, record);
}

export function getSession(sessionId: string): GatewaySessionRecord | undefined {
  return sessionsMap().get(sessionId);
}

export function deleteSession(sessionId: string): boolean {
  return sessionsMap().delete(sessionId);
}

export function assertSessionOwner(
  record: GatewaySessionRecord,
  ownerTokenHash: string,
): void {
  if (record.ownerTokenHash !== ownerTokenHash) {
    throw new Error("Forbidden: session does not belong to this bearer token");
  }
}

export function closeSessionRecord(record: GatewaySessionRecord): void {
  if (record.closed) {
    return;
  }
  record.closed = true;
  if (record.paymentInterval) {
    clearInterval(record.paymentInterval);
    record.paymentInterval = undefined;
  }
}
