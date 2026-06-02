import type { GatewayServerConfig } from "./config.js";
import {
  extractBearerToken,
  disabledResponse,
  forbiddenResponse,
  unauthorizedResponse,
} from "./auth.js";
import { TRICKLE_SEQ_CURRENT } from "../types.js";
import { startLv2vSession } from "./lv2v.js";
import {
  assertSessionOwner,
  closeSessionRecord,
  createSessionId,
  deleteSession,
  getSession,
  hashBearerToken,
  putSession,
} from "./session-store.js";
import {
  closeTricklePublish,
  prepareTricklePublish,
  publishTrickleSegment,
  subscribeTrickleSegment,
} from "./trickle-relay.js";
import type { StartGatewaySessionRequest } from "../types.js";

function signerHeadersFromBearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function startPaymentLoop(
  config: GatewayServerConfig,
  record: ReturnType<typeof getSession>,
): void {
  if (!record || record.paymentInterval) {
    return;
  }
  record.paymentInterval = setInterval(() => {
    void record.paymentSession.sendPayment(record.orchestratorUrl).catch(() => undefined);
  }, config.paymentIntervalMs);
}

async function parseStartGatewaySessionRequest(
  request: Request,
  config: GatewayServerConfig,
): Promise<StartGatewaySessionRequest | Response> {
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const record = parsed as Record<string, unknown>;
    const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
    if (!modelId) {
      return Response.json({ error: "modelId is required" }, { status: 400 });
    }
    return {
      modelId,
      orchestratorUrl:
        typeof record.orchestratorUrl === "string" ? record.orchestratorUrl : undefined,
      discoveryUrl:
        typeof record.discoveryUrl === "string" ? record.discoveryUrl : config.discoveryUrl,
      params:
        record.params && typeof record.params === "object" && !Array.isArray(record.params)
          ? (record.params as Record<string, unknown>)
          : undefined,
      streamId: typeof record.streamId === "string" ? record.streamId : undefined,
      requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
}

async function startGatewaySessionRecord(
  config: GatewayServerConfig,
  token: string,
  body: StartGatewaySessionRequest,
): Promise<Response> {
  try {
    const job = await startLv2vSession({
      request: body,
      signerUrl: config.signerUrl,
      signerHeaders: signerHeadersFromBearer(token),
      discoveryUrl: config.discoveryUrl,
      discoveryTimeoutMs: config.discoveryTimeoutMs,
      useTofu: config.useTofu,
    });

    const sessionId = createSessionId();
    const ownerTokenHash = hashBearerToken(token);
    const sessionRecord = {
      id: sessionId,
      ownerTokenHash,
      manifestId: job.manifestId,
      publishUrl: job.publishUrl,
      subscribeUrl: job.subscribeUrl,
      controlUrl: job.controlUrl,
      mimeType: job.mimeType,
      paymentSession: job.paymentSession,
      orchestratorUrl: job.orchestratorUrl,
      publishSeq: -1,
      subscribeSeq: TRICKLE_SEQ_CURRENT,
      trickleCreated: false,
      trickleResetSent: false,
      closed: false,
    };
    putSession(sessionRecord);
    startPaymentLoop(config, sessionRecord);

    let publishSeq = 0;
    try {
      await prepareTricklePublish(sessionRecord);
      publishSeq = Math.max(0, sessionRecord.publishSeq);
    } catch (prepareErr) {
      const message = prepareErr instanceof Error ? prepareErr.message : String(prepareErr);
      return Response.json({ error: "trickle_prepare_failed", message }, { status: 502 });
    }

    return Response.json({
      sessionId,
      manifestId: job.manifestId,
      mimeType: job.mimeType,
      publishSeq,
      subscribeSeq: sessionRecord.subscribeSeq,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "start_session_failed", message }, { status: 502 });
  }
}

export function createGatewayStartSessionHandler(config: GatewayServerConfig | null) {
  return async (request: Request): Promise<Response> => {
    if (!config) {
      return disabledResponse();
    }
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorizedResponse();
    }

    const body = await parseStartGatewaySessionRequest(request, config);
    if (body instanceof Response) {
      return body;
    }
    return startGatewaySessionRecord(config, token, body);
  };
}

export function createGatewayPublishSegmentHandler(config: GatewayServerConfig | null) {
  return async (
    request: Request,
    context: { params: Promise<{ id: string; seq: string }> },
  ): Promise<Response> => {
    if (!config) {
      return disabledResponse();
    }
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorizedResponse();
    }

    const { id, seq: seqRaw } = await context.params;
    const seq = Number.parseInt(seqRaw, 10);
    if (!Number.isFinite(seq)) {
      return Response.json({ error: "invalid_seq" }, { status: 400 });
    }

    const record = getSession(id);
    if (!record || record.closed) {
      return Response.json({ error: "session_not_found" }, { status: 404 });
    }

    try {
      assertSessionOwner(record, hashBearerToken(token));
    } catch {
      return forbiddenResponse();
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    const contentType =
      request.headers.get("Content-Type")?.trim() || record.mimeType;

    try {
      await publishTrickleSegment(record, seq, bytes, contentType);
      record.publishSeq = Math.max(record.publishSeq, seq);
      return Response.json({ seq, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: "publish_failed", message }, { status: 502 });
    }
  };
}

export function createGatewaySubscribeSegmentHandler(config: GatewayServerConfig | null) {
  return async (
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    if (!config) {
      return disabledResponse();
    }
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorizedResponse();
    }

    const { id } = await context.params;
    const record = getSession(id);
    if (!record || record.closed) {
      return Response.json({ error: "session_not_found" }, { status: 404 });
    }

    try {
      assertSessionOwner(record, hashBearerToken(token));
    } catch {
      return forbiddenResponse();
    }

    const url = new URL(request.url);
    const seqParam = url.searchParams.get("seq");
    const seq =
      seqParam === null ? record.subscribeSeq : Number.parseInt(seqParam, 10);

    try {
      const segment = await subscribeTrickleSegment(record, seq);
      if (!segment) {
        return new Response(null, { status: 204 });
      }
      if ("wait" in segment) {
        return new Response(null, {
          status: 204,
          headers: {
            "X-Gateway-Latest-Seq": String(segment.latestSeq),
            "X-Gateway-Wait": "1",
          },
        });
      }
      record.subscribeSeq = segment.nextSeq;
      return new Response(segment.data, {
        status: 200,
        headers: {
          "Content-Type": segment.contentType,
          "X-Gateway-Segment-Seq": String(segment.segmentSeq),
          "X-Gateway-Next-Seq": String(segment.nextSeq),
          "X-Gateway-Latest-Seq": String(segment.latestSeq),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: "subscribe_failed", message }, { status: 502 });
    }
  };
}

export function createGatewayStopSessionHandler(config: GatewayServerConfig | null) {
  return async (
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    if (!config) {
      return disabledResponse();
    }
    const token = extractBearerToken(request);
    if (!token) {
      return unauthorizedResponse();
    }

    const { id } = await context.params;
    const record = getSession(id);
    if (!record) {
      return new Response(null, { status: 204 });
    }

    try {
      assertSessionOwner(record, hashBearerToken(token));
    } catch {
      return forbiddenResponse();
    }

    closeSessionRecord(record);
    await closeTricklePublish(record).catch(() => undefined);
    deleteSession(id);
    return new Response(null, { status: 204 });
  };
}
