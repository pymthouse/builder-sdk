import { discoverOrchestrators } from "./discovery.js";
import { getOrchestratorInfo } from "./orch-grpc.js";
import { httpOrigin, insecureFetch, readJsonResponse } from "./http-insecure.js";
import { PaymentSession } from "./payment-session.js";
import type { StartGatewaySessionRequest } from "../types.js";
import { DEFAULT_TRICKLE_MIME_TYPE } from "../types.js";

export type Lv2vJobResult = {
  manifestId: string;
  publishUrl: string;
  subscribeUrl: string;
  controlUrl?: string;
  eventsUrl?: string;
  mimeType: string;
  paymentSession: PaymentSession;
  orchestratorUrl: string;
};

export type StartLv2vSessionInput = {
  request: StartGatewaySessionRequest;
  signerUrl: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryTimeoutMs?: number;
  useTofu?: boolean;
};

export async function startLv2vSession(input: StartLv2vSessionInput): Promise<Lv2vJobResult> {
  const orchList = await discoverOrchestrators({
    orchestratorUrl: input.request.orchestratorUrl,
    discoveryUrl: input.request.discoveryUrl ?? input.discoveryUrl,
    signerUrl: input.signerUrl,
    signerHeaders: input.signerHeaders,
    modelId: input.request.modelId,
    discoveryTimeoutMs: input.discoveryTimeoutMs,
  });

  if (orchList.length === 0) {
    throw new Error("No orchestrators discovered");
  }

  const rejections: Array<{ url: string; reason: string }> = [];
  for (const orchUrl of orchList) {
    try {
      return await startLv2vOnOrchestrator(orchUrl, input);
    } catch (err) {
      rejections.push({
        url: orchUrl,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new Error(
    `All orchestrators failed (${rejections.length} tried): ${rejections
      .map((r) => `${r.url}: ${r.reason}`)
      .join("; ")}`,
  );
}

async function startLv2vOnOrchestrator(
  orchUrl: string,
  input: StartLv2vSessionInput,
): Promise<Lv2vJobResult> {
  const info = await getOrchestratorInfo({
    orchUrl,
    signerUrl: input.signerUrl,
    signerHeaders: input.signerHeaders,
    modelId: input.request.modelId,
    useTofu: input.useTofu,
  });

  const paymentSession = new PaymentSession(
    input.signerUrl,
    info,
    input.signerHeaders,
    input.request.modelId,
    input.useTofu !== false,
  );

  const paymentHeaders = await paymentSession.getPaymentHeaders();
  const transcoder = paymentSession.transcoderUrl;
  const url = `${httpOrigin(transcoder)}/live-video-to-video`;

  const body: Record<string, unknown> = {
    model_id: input.request.modelId,
  };
  if (input.request.params) {
    body.params = input.request.params;
  }
  if (input.request.streamId) {
    body.stream_id = input.request.streamId;
  }
  if (input.request.requestId) {
    body.gateway_request_id = input.request.requestId;
  }

  const response = await insecureFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Livepeer-Payment": paymentHeaders.payment,
      "Livepeer-Segment": paymentHeaders.segCreds,
    },
    body: Buffer.from(JSON.stringify(body)),
    timeoutMs: 10_000,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`live-video-to-video HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await readJsonResponse<{
    manifest_id?: string;
    publish_url?: string;
    subscribe_url?: string;
    control_url?: string;
    events_url?: string;
  }>(response);

  const manifestId = data.manifest_id?.trim();
  const publishUrl = data.publish_url?.trim();
  const subscribeUrl = data.subscribe_url?.trim();
  if (!manifestId) {
    throw new Error("live-video-to-video response missing manifest_id");
  }
  if (!publishUrl) {
    throw new Error("live-video-to-video response missing publish_url");
  }
  if (!subscribeUrl) {
    throw new Error("live-video-to-video response missing subscribe_url");
  }

  paymentSession.setManifestId(manifestId);

  return {
    manifestId,
    publishUrl,
    subscribeUrl,
    controlUrl: data.control_url?.trim(),
    eventsUrl: data.events_url?.trim(),
    mimeType: DEFAULT_TRICKLE_MIME_TYPE,
    paymentSession,
    orchestratorUrl: orchUrl,
  };
}
