import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { WebSocketServer, WebSocket } from "ws";

import { startByocJob } from "./byoc.js";
import { GatewayError } from "./errors.js";
import {
  attachStartedJob,
  jobProxyPaths,
  JobSessionStore,
  normalizeBasePath,
  resolveSignerFromRequest,
  sendControlMessage,
  stopJobSession,
  streamJobEvents,
  type GatewayHandlers,
} from "./job-session.js";
import type { BYOCJobRequestInput, GatewayProxyOptions, SignerConfig } from "./types.js";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function matchRoute(
  pathname: string,
  basePath: string,
): { kind: "jobs" } | { kind: "job"; jobId: string; action: string } | null {
  const base = normalizeBasePath(basePath);
  if (pathname === `${base}/jobs`) {
    return { kind: "jobs" };
  }
  const prefix = `${base}/jobs/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const jobId = decodeURIComponent(rest.slice(0, slash));
  const action = rest.slice(slash + 1);
  return { kind: "job", jobId, action };
}

function matchWsRoute(pathname: string, basePath: string): string | null {
  const base = normalizeBasePath(basePath);
  const prefix = `${base}/ws/`;
  if (!pathname.startsWith(prefix)) return null;
  return decodeURIComponent(pathname.slice(prefix.length));
}

async function resolveAuth(
  req: IncomingMessage,
  options: GatewayProxyOptions,
): Promise<SignerConfig | null> {
  if (options.authenticate) {
    return options.authenticate(req);
  }
  return resolveSignerFromRequest(req, options);
}

export function createGatewayHandlers(options: GatewayProxyOptions = {}): GatewayHandlers {
  const basePath = options.basePath ?? "/pymthouse/gateway";
  const sessionStore = new JobSessionStore();
  const wss = options.enableWebSocket === false ? null : new WebSocketServer({ noServer: true });

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (!req.url || req.method === undefined) return false;
    const url = new URL(req.url, "http://localhost");
    const route = matchRoute(url.pathname, basePath);
    if (!route) return false;

    try {
      if (route.kind === "jobs" && req.method === "POST") {
        const auth = await resolveAuth(req, options);
        if (!auth?.signerUrl) {
          sendJson(res, 401, { error: "Unauthorized: missing signer session" });
          return true;
        }

        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const request = (body.request ?? {}) as BYOCJobRequestInput;
        if (typeof body.capability === "string") request.capability = body.capability;
        if (typeof body.token === "string") {
          /* passed via start options */
        }

        const started = await startByocJob(request, {
          orchestrators: typeof body.orchestrators === "string" ? body.orchestrators : undefined,
          token: typeof body.token === "string" ? body.token : undefined,
          signerUrl: auth.signerUrl,
          signerHeaders: auth.signerHeaders,
          discoveryUrl: auth.discoveryUrl ?? options.discoveryUrl,
          discoveryHeaders: auth.discoveryHeaders,
          billingBaseUrl: options.billingBaseUrl,
          useTofu: options.useTofu,
        });

        const session = attachStartedJob(sessionStore, started);
        const proxy = jobProxyPaths(basePath, session.job.jobId);
        sendJson(res, 200, { job: session.job, proxy });
        return true;
      }

      if (route.kind === "job") {
        const session = sessionStore.get(route.jobId);
        if (!session) {
          sendJson(res, 404, { error: "Job not found" });
          return true;
        }

        if (route.action === "control" && req.method === "POST") {
          const message = (await readJsonBody(req)) as Record<string, unknown>;
          await sendControlMessage(session, message);
          sendJson(res, 200, { ok: true });
          return true;
        }

        if (route.action === "stop" && req.method === "POST") {
          const result = await stopJobSession(session);
          sessionStore.cleanup(session);
          sendJson(res, 200, result);
          return true;
        }

        if (route.action === "status" && req.method === "GET") {
          sendJson(res, 200, {
            jobId: session.job.jobId,
            capability: session.job.capability,
            status: session.job.status,
            error: session.error,
          });
          return true;
        }

        if (route.action === "events" && req.method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          try {
            for await (const event of streamJobEvents(session)) {
              if (res.writableEnded) break;
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          } catch (error) {
            if (!res.writableEnded) {
              const message = error instanceof Error ? error.message : String(error);
              res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
            }
          }
          res.end();
          return true;
        }
      }

      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    } catch (error) {
      const status = error instanceof GatewayError ? 502 : 500;
      sendJson(res, status, {
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof GatewayError ? error.code : "internal_error",
      });
      return true;
    }
  };

  const handleUpgrade = async (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): Promise<boolean> => {
    if (!wss || !req.url) return false;
    const url = new URL(req.url, "http://localhost");
    const jobId = matchWsRoute(url.pathname, basePath);
    if (!jobId) return false;

    const session = sessionStore.get(jobId);
    if (!session) {
      socket.destroy();
      return true;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleJobWebSocket(ws, session, sessionStore);
    });
    return true;
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
  };

  const onUpgrade = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    void handleUpgrade(req, socket, head);
  };

  return {
    handleRequest,
    handleUpgrade,
    detach: () => {
      wss?.close();
    },
  };
}

async function handleJobWebSocket(
  ws: WebSocket,
  session: import("./job-session.js").JobSession,
  sessionStore: JobSessionStore,
): Promise<void> {
  ws.send(JSON.stringify({ type: "ready", jobId: session.job.jobId }));

  const eventsTask = (async () => {
    try {
      for await (const event of streamJobEvents(session)) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "event", data: event }));
      }
      ws.send(JSON.stringify({ type: "eos" }));
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  })();

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const message = JSON.parse(text) as { type?: string; payload?: Record<string, unknown> };
        if (message.type === "control" && message.payload) {
          await sendControlMessage(session, message.payload);
          ws.send(JSON.stringify({ type: "control-ack" }));
        }
        if (message.type === "stop") {
          const result = await stopJobSession(session);
          sessionStore.cleanup(session);
          ws.send(JSON.stringify({ type: "stopped", statusCode: result.status_code }));
          ws.close();
        }
      } catch (error) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    })();
  });

  ws.on("close", () => {
    session.abortController.abort();
  });

  await eventsTask;
}

export function attachPmtHouseGatewayProxy(
  server: import("node:http").Server,
  options: GatewayProxyOptions = {},
): GatewayHandlers {
  const handlers = createGatewayHandlers(options);

  const requestListener = (req: IncomingMessage, res: ServerResponse) => {
    void handlers.handleRequest(req, res);
  };

  const upgradeListener = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    void handlers.handleUpgrade(req, socket, head);
  };

  server.on("request", requestListener);
  server.on("upgrade", upgradeListener);

  const originalDetach = handlers.detach;
  handlers.detach = () => {
    server.off("request", requestListener);
    server.off("upgrade", upgradeListener);
    originalDetach();
  };

  return handlers;
}
