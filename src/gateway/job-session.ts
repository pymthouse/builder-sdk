import type { IncomingMessage } from "node:http";

import type { BYOCJobRecord, GatewayProxyOptions, SignerConfig } from "./types.js";
import type { StartedBYOCJob } from "./byoc.js";
import { BYOCPaymentSession } from "./byoc.js";
import { TricklePublisher, subscribeTrickleJson } from "./trickle.js";
import { postByocJson } from "./http.js";
import { resolveBillingSigner } from "./token.js";
import { GatewayError } from "./errors.js";

export interface JobSession {
  job: BYOCJobRecord;
  signedJobHeader: string;
  streamStopUrl: string;
  paymentSession: BYOCPaymentSession;
  paymentTimer?: ReturnType<typeof setInterval>;
  controlPublisher?: TricklePublisher;
  abortController: AbortController;
  error?: string;
}

export class JobSessionStore {
  private readonly sessions = new Map<string, JobSession>();

  set(session: JobSession): void {
    this.sessions.set(session.job.jobId, session);
  }

  get(jobId: string): JobSession | undefined {
    return this.sessions.get(jobId);
  }

  delete(jobId: string): void {
    const session = this.sessions.get(jobId);
    if (session) {
      this.cleanup(session);
      this.sessions.delete(jobId);
    }
  }

  cleanup(session: JobSession): void {
    session.abortController.abort();
    if (session.paymentTimer) clearInterval(session.paymentTimer);
  }
}

export function startPaymentLoop(session: JobSession): void {
  if (session.paymentTimer) return;
  const send = async () => {
    try {
      await session.paymentSession.sendStreamPayment(session.signedJobHeader);
    } catch (error) {
      if (error instanceof GatewayError && error.code === "skip_payment_cycle") return;
    }
  };
  void send();
  session.paymentTimer = setInterval(() => {
    void send();
  }, 5000);
}

export function attachStartedJob(sessionStore: JobSessionStore, started: StartedBYOCJob): JobSession {
  const session: JobSession = {
    ...started,
    abortController: new AbortController(),
  };
  if (started.job.controlUrl) {
    session.controlPublisher = new TricklePublisher(started.job.controlUrl, "application/json");
  }
  startPaymentLoop(session);
  sessionStore.set(session);
  return session;
}

export async function sendControlMessage(
  session: JobSession,
  message: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!session.controlPublisher) {
    throw new GatewayError("No control_url present on this BYOC job");
  }
  await session.controlPublisher.writeMessage(message, fetchImpl);
}

export async function stopJobSession(
  session: JobSession,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status_code: number }> {
  const data = await postByocJson(
    session.streamStopUrl,
    { stream_id: session.job.jobId },
    { Livepeer: session.signedJobHeader },
    "stop",
    { fetchImpl },
  );
  session.job.status = "stopped";
  return { status_code: data.status_code };
}

export async function* streamJobEvents(
  session: JobSession,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<Record<string, unknown>> {
  if (!session.job.eventsUrl) {
    throw new GatewayError("No events_url present on this BYOC job");
  }
  for await (const event of subscribeTrickleJson(session.job.eventsUrl, {
    fetchImpl,
  })) {
    if (session.abortController.signal.aborted) return;
    yield event;
  }
}

export function resolveSignerFromRequest(
  req: IncomingMessage,
  options: GatewayProxyOptions,
): SignerConfig | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (options.billingBaseUrl && token) {
      return resolveBillingSigner(options.billingBaseUrl, token);
    }
  }
  return null;
}

export interface GatewayHandlers {
  handleRequest: (req: IncomingMessage, res: import("node:http").ServerResponse) => Promise<boolean>;
  handleUpgrade: (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => Promise<boolean>;
  detach: () => void;
}

export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function jobProxyPaths(basePath: string, jobId: string): {
  controlUrl: string;
  eventsUrl: string;
  stopUrl: string;
  statusUrl: string;
  wsUrl: string;
} {
  const base = normalizeBasePath(basePath);
  return {
    controlUrl: `${base}/jobs/${encodeURIComponent(jobId)}/control`,
    eventsUrl: `${base}/jobs/${encodeURIComponent(jobId)}/events`,
    stopUrl: `${base}/jobs/${encodeURIComponent(jobId)}/stop`,
    statusUrl: `${base}/jobs/${encodeURIComponent(jobId)}/status`,
    wsUrl: `${base}/ws/${encodeURIComponent(jobId)}`,
  };
}
