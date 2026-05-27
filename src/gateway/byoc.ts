import { randomUUID } from "node:crypto";

import { buildCapabilities, CapabilityId } from "./capabilities.js";
import {
  GatewayError,
  NoOrchestratorAvailableError,
  PaymentError,
  PaymentRequiredError,
  SkipPaymentCycle,
} from "./errors.js";
import { encodeCapabilities, encodeOrchestratorInfo, getOrchInfo } from "./orch-info.js";
import { postByocJson, postEmpty, resolveTranscoderHttpUrl } from "./http.js";
import {
  generateLivePayment,
  signByocJobRemote,
} from "./remote-signer.js";
import { orchestratorSelector } from "./selection.js";
import { parseGatewayToken, resolveTokenSignerConfig } from "./token.js";
import type {
  BYOCJobRecord,
  BYOCJobRequestInput,
  BYOCJobStartOptions,
  OrchestratorInfoMessage,
} from "./types.js";

type StartByocOptions = BYOCJobStartOptions & {
  billingBaseUrl?: string;
  fetchImpl?: typeof fetch;
};

type ResolvedByocStartConfig = {
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  orchestrators?: string | string[];
  capabilityName: string;
  capabilities: ReturnType<typeof buildCapabilities>;
  useTofu: boolean;
  fetchImpl?: typeof fetch;
};

function fieldValue(obj: OrchestratorInfoMessage, snake: string, camel: string): unknown {
  if (snake in obj) return obj[snake];
  if (camel in obj) return obj[camel];
  return undefined;
}

function nonzeroRealScalar(val: unknown): boolean {
  if (val == null || typeof val === "boolean") return false;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    try {
      return BigInt(val) > 0n;
    } catch {
      return false;
    }
  }
  if (Buffer.isBuffer(val)) return val.length > 0 && BigInt(`0x${val.toString("hex")}`) > 0n;
  return false;
}

function orchInfoTicketParamsUsable(info: OrchestratorInfoMessage): boolean {
  const params = fieldValue(info, "ticket_params", "ticketParams");
  if (!params || typeof params !== "object") return false;
  const face = fieldValue(params as OrchestratorInfoMessage, "face_value", "faceValue");
  const win = fieldValue(params as OrchestratorInfoMessage, "win_prob", "winProb");
  return nonzeroRealScalar(face) && nonzeroRealScalar(win);
}

function priceInfoMatchesByoc(priceInfo: unknown, capabilityName: string): boolean {
  if (!priceInfo || typeof priceInfo !== "object") return false;
  const capability = fieldValue(priceInfo as OrchestratorInfoMessage, "capability", "capability");
  const constraint = fieldValue(priceInfo as OrchestratorInfoMessage, "constraint", "constraint");
  const pricePerUnit = fieldValue(priceInfo as OrchestratorInfoMessage, "price_per_unit", "pricePerUnit");
  const pixelsPerUnit = fieldValue(
    priceInfo as OrchestratorInfoMessage,
    "pixels_per_unit",
    "pixelsPerUnit",
  );
  return (
    capability === CapabilityId.BYOC &&
    constraint === capabilityName &&
    nonzeroRealScalar(pricePerUnit) &&
    nonzeroRealScalar(pixelsPerUnit)
  );
}

function orchInfoHasByocPrice(info: OrchestratorInfoMessage, capabilityName: string): boolean {
  const topPrice = fieldValue(info, "price_info", "priceInfo");
  if (priceInfoMatchesByoc(topPrice, capabilityName)) return true;
  const capsPrices = fieldValue(info, "capabilities_prices", "capabilitiesPrices");
  if (!Array.isArray(capsPrices)) return false;
  return capsPrices.some((price) => priceInfoMatchesByoc(price, capabilityName));
}

function orchInfoAggregatePriceUsable(info: OrchestratorInfoMessage): boolean {
  const top = fieldValue(info, "price_info", "priceInfo");
  if (!top || typeof top !== "object") return false;
  return (
    nonzeroRealScalar(fieldValue(top as OrchestratorInfoMessage, "price_per_unit", "pricePerUnit")) &&
    nonzeroRealScalar(fieldValue(top as OrchestratorInfoMessage, "pixels_per_unit", "pixelsPerUnit"))
  );
}

function orchInfoSupportsByocPayment(info: OrchestratorInfoMessage, capabilityName: string): boolean {
  if (!orchInfoTicketParamsUsable(info)) return false;
  if (orchInfoHasByocPrice(info, capabilityName)) return true;
  return orchInfoAggregatePriceUsable(info);
}

async function getPaymentOrchInfo(
  orchUrl: string,
  options: {
    signerUrl?: string;
    signerHeaders?: Record<string, string>;
    capabilities: ReturnType<typeof buildCapabilities>;
    capabilityName: string;
    useTofu: boolean;
    fetchImpl?: typeof fetch;
  },
): Promise<[OrchestratorInfoMessage, ReturnType<typeof buildCapabilities>]> {
  const paymentInfo = await getOrchInfo({
    orchUrl,
    signerUrl: options.signerUrl,
    signerHeaders: options.signerHeaders,
    capabilities: options.capabilities,
    useTofu: options.useTofu,
    fetchImpl: options.fetchImpl,
  });
  if (orchInfoSupportsByocPayment(paymentInfo, options.capabilityName)) {
    return [paymentInfo, options.capabilities];
  }
  const legacyInfo = await getOrchInfo({
    orchUrl,
    signerUrl: options.signerUrl,
    signerHeaders: options.signerHeaders,
    useTofu: options.useTofu,
    fetchImpl: options.fetchImpl,
  });
  if (orchInfoSupportsByocPayment(legacyInfo, options.capabilityName)) {
    return [legacyInfo, options.capabilities];
  }
  return [paymentInfo, options.capabilities];
}

function headerGet(headers: Record<string, string>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === lower) return value;
  }
  return undefined;
}

function deriveStreamStopUrl(startUrl: string, jobId: string): string {
  const parsed = new URL(startUrl);
  let path = parsed.pathname;
  const encoded = encodeURIComponent(jobId);
  if (path.endsWith("/process/stream/start")) {
    path = `${path.slice(0, -"/process/stream/start".length)}/process/stream/${encoded}/stop`;
  } else if (path.endsWith("/start")) {
    path = `${path.slice(0, -"/start".length)}/stop`;
  } else {
    throw new Error(`Cannot derive stream stop URL from start URL: ${startUrl}`);
  }
  parsed.pathname = path;
  return parsed.toString();
}

function buildSignedJobHeader(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export class BYOCPaymentSession {
  private info: OrchestratorInfoMessage;
  private state: Record<string, unknown> | null = null;
  private timeoutSeconds = 0;
  private manifestId: string | null = null;

  constructor(
    private readonly signerUrl: string | undefined,
    info: OrchestratorInfoMessage,
    private readonly capabilityName: string,
    private readonly signerHeaders?: Record<string, string>,
    private readonly capabilities?: ReturnType<typeof buildCapabilities>,
    private readonly streamPaymentEndpoint = "/ai/stream/payment",
    private readonly useTofu = true,
    private readonly fetchImpl?: typeof fetch,
    private readonly maxRefreshRetries = 3,
  ) {
    this.info = info;
  }

  setTimeoutSeconds(timeoutSeconds: number): void {
    this.timeoutSeconds = Math.max(0, Math.floor(timeoutSeconds));
  }

  private buildPaymentPayload(): Record<string, unknown> {
    if (!this.manifestId) {
      throw new PaymentError("BYOC payment requires a signed job_id before requesting payment");
    }
    const payload: Record<string, unknown> = {
      orchestrator: encodeOrchestratorInfo(this.info),
      type: "byoc",
      RequestID: randomUUID(),
      manifestID: this.manifestId,
    };
    if (this.timeoutSeconds > 0) payload.preloadSeconds = this.timeoutSeconds;
    if (this.state) payload.state = this.state;
    if (this.capabilities) payload.capabilities = encodeCapabilities(this.capabilities);
    return payload;
  }

  private async refreshOrchestratorInfo(): Promise<void> {
    const transcoder = fieldValue(this.info, "transcoder", "transcoder");
    if (typeof transcoder !== "string" || !transcoder) {
      throw new PaymentError("OrchestratorInfo missing transcoder URL for refresh");
    }
    this.info = await getOrchInfo({
      orchUrl: transcoder,
      signerUrl: this.signerUrl,
      signerHeaders: this.signerHeaders,
      capabilities: this.capabilities,
      useTofu: this.useTofu,
      fetchImpl: this.fetchImpl,
    });
  }

  async getPayment(): Promise<{ payment: string; segCreds?: string }> {
    if (!this.signerUrl) return { payment: "", segCreds: "" };
    let attempts = 0;
    while (true) {
      try {
        const response = await generateLivePayment(
          this.signerUrl,
          this.buildPaymentPayload(),
          this.signerHeaders,
          this.fetchImpl,
        );
        this.state = response.state;
        return { payment: response.payment, segCreds: response.segCreds };
      } catch (error) {
        if (error instanceof GatewayError && error.code === "signer_refresh_required") {
          if (attempts >= this.maxRefreshRetries) {
            throw new PaymentError(`Signer refresh required after ${attempts} retries: ${error.message}`);
          }
          await this.refreshOrchestratorInfo();
          attempts += 1;
          continue;
        }
        throw error;
      }
    }
  }

  async signByocJob(input: {
    jobId: string;
    capability: string;
    request: string;
    parameters: string;
    timeoutSeconds: number;
  }): Promise<{ sender: string; signature: string }> {
    if (!this.signerUrl) throw new PaymentError("sign_byoc_job requires signer_url");
    this.setTimeoutSeconds(input.timeoutSeconds);
    this.manifestId = input.jobId.trim();
    return signByocJobRemote(
      this.signerUrl,
      {
        id: input.jobId,
        capability: input.capability,
        request: input.request,
        parameters: input.parameters,
        timeout_seconds: this.timeoutSeconds,
        signature_format: "v1",
      },
      this.signerHeaders,
      this.fetchImpl,
    );
  }

  async sendStreamPayment(jobHeader: string): Promise<void> {
    const transcoder = fieldValue(this.info, "transcoder", "transcoder");
    if (typeof transcoder !== "string" || !transcoder) {
      throw new PaymentError("OrchestratorInfo missing transcoder URL for stream payment");
    }
    const payment = await this.getPayment();
    const url = resolveTranscoderHttpUrl(transcoder, this.streamPaymentEndpoint);
    await postEmpty(
      url,
      {
        Livepeer: jobHeader,
        "Livepeer-Payment": payment.payment,
        "Livepeer-Segment": payment.segCreds ?? "",
      },
      "stream payment",
      { fetchImpl: this.fetchImpl },
    );
  }
}

export interface StartedBYOCJob {
  job: BYOCJobRecord;
  signedJobHeader: string;
  streamStopUrl: string;
  paymentSession: BYOCPaymentSession;
}

function createByocPayloads(
  req: BYOCJobRequestInput,
  jobId: string,
): { requestJson: string; parametersJson: string; startPayload: Record<string, unknown> } {
  const requestPayload: Record<string, unknown> = {};
  if (req.request) {
    Object.assign(requestPayload, req.request);
  }
  requestPayload.stream_id = req.streamId ?? jobId;

  const parametersPayload: Record<string, unknown> = {
    enable_video_ingress: req.enableVideoIngress ?? true,
    enable_video_egress: req.enableVideoEgress ?? true,
    enable_data_output: req.enableDataOutput ?? false,
  };
  if (req.parameters) {
    Object.assign(parametersPayload, req.parameters);
  }

  const startPayload: Record<string, unknown> = {};
  if (req.body) {
    Object.assign(startPayload, req.body);
  }
  startPayload.stream_id = req.streamId ?? jobId;

  return {
    requestJson: JSON.stringify(requestPayload),
    parametersJson: JSON.stringify(parametersPayload),
    startPayload,
  };
}

function resolveByocStartConfig(
  req: BYOCJobRequestInput,
  options: StartByocOptions,
): ResolvedByocStartConfig {
  if (!req.capability?.trim()) {
    throw new GatewayError("start_byoc_job requires a non-empty capability");
  }

  let signerUrl = options.signerUrl;
  let signerHeaders = options.signerHeaders;
  let discoveryUrl = options.discoveryUrl;
  let discoveryHeaders = options.discoveryHeaders;
  let orchestrators = options.orchestrators;

  if (options.token) {
    const tokenData = parseGatewayToken(options.token);
    const resolved = resolveTokenSignerConfig(tokenData, options.billingBaseUrl);
    signerUrl ??= resolved.signerUrl;
    signerHeaders ??= resolved.signerHeaders;
    discoveryUrl ??= resolved.discoveryUrl;
    discoveryHeaders ??= resolved.discoveryHeaders;
    orchestrators ??= resolved.orchestrators;
  }

  const capabilityName = req.capability.trim();
  return {
    signerUrl,
    signerHeaders,
    discoveryUrl,
    discoveryHeaders,
    orchestrators,
    capabilityName,
    capabilities: buildCapabilities(CapabilityId.BYOC, capabilityName),
    useTofu: options.useTofu ?? true,
    fetchImpl: options.fetchImpl,
  };
}

function getTranscoderUrl(paymentInfo: OrchestratorInfoMessage): string {
  const transcoder = fieldValue(paymentInfo, "transcoder", "transcoder");
  if (typeof transcoder !== "string" || !transcoder) {
    throw new GatewayError("OrchestratorInfo missing transcoder URL");
  }
  return transcoder;
}

async function getStartPaymentHeaders(
  session: BYOCPaymentSession,
  paymentInfo: OrchestratorInfoMessage,
  capabilityName: string,
  allowSkip: boolean,
): Promise<{ paymentHeader?: string; segmentHeader: string }> {
  try {
    const payment = await session.getPayment();
    return { paymentHeader: payment.payment, segmentHeader: payment.segCreds ?? "" };
  } catch (error) {
    if (error instanceof SkipPaymentCycle) {
      if (!allowSkip) {
        throw new GatewayError(
          "BYOC start endpoint returned HTTP 402 payment required, but the signer skipped payment generation",
        );
      }
      if (!orchInfoTicketParamsUsable(paymentInfo)) {
        throw new GatewayError(
          "BYOC signer returned skip-payment, but OrchestratorInfo ticket_params are missing or zero",
        );
      }
      return { segmentHeader: "" };
    }
    throw error;
  }
}

async function postStartWithPaymentRetry(
  params: {
    startUrl: string;
    startPayload: Record<string, unknown>;
    headers: Record<string, string>;
    signedJobHeader: string;
    timeoutSeconds: number;
    session: BYOCPaymentSession;
    paymentInfo: OrchestratorInfoMessage;
    capabilityName: string;
    fetchImpl?: typeof fetch;
  },
): Promise<Awaited<ReturnType<typeof postByocJson>>> {
  try {
    return await postByocJson(params.startUrl, params.startPayload, params.headers, "start", {
      timeoutMs: params.timeoutSeconds * 1000,
      fetchImpl: params.fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof PaymentRequiredError)) throw error;
    const retryHeaders = await getStartPaymentHeaders(
      params.session,
      params.paymentInfo,
      params.capabilityName,
      false,
    );
    const retryPaymentHeader = retryHeaders.paymentHeader;
    if (!retryPaymentHeader) {
      throw new GatewayError("BYOC start retry requires a payment header");
    }
    return postByocJson(
      params.startUrl,
      params.startPayload,
      {
        Livepeer: params.signedJobHeader,
        "Livepeer-Payment": retryPaymentHeader,
        "Livepeer-Segment": retryHeaders.segmentHeader,
      },
      "start",
      { timeoutMs: params.timeoutSeconds * 1000, fetchImpl: params.fetchImpl },
    );
  }
}

async function startSelectedByocJob(
  selectedUrl: string,
  req: BYOCJobRequestInput,
  config: ResolvedByocStartConfig,
): Promise<StartedBYOCJob> {
  const [paymentInfo] = await getPaymentOrchInfo(selectedUrl, {
    signerUrl: config.signerUrl,
    signerHeaders: config.signerHeaders,
    capabilities: config.capabilities,
    capabilityName: config.capabilityName,
    useTofu: config.useTofu,
    fetchImpl: config.fetchImpl,
  });

  const session = new BYOCPaymentSession(
    config.signerUrl,
    paymentInfo,
    config.capabilityName,
    config.signerHeaders,
    config.capabilities,
    req.streamPaymentEndpoint ?? "/ai/stream/payment",
    config.useTofu,
    config.fetchImpl,
  );
  const jobId = req.requestId?.trim() || req.streamId?.trim() || randomUUID().replaceAll("-", "");
  const { requestJson, parametersJson, startPayload } = createByocPayloads(req, jobId);
  const timeoutSeconds = Math.max(1, req.timeoutSeconds ?? 30);
  const signed = await session.signByocJob({
    jobId,
    capability: config.capabilityName,
    request: requestJson,
    parameters: parametersJson,
    timeoutSeconds,
  });
  const signedJobHeader = buildSignedJobHeader({
    id: jobId,
    request: requestJson,
    parameters: parametersJson,
    capability: config.capabilityName,
    sender: signed.sender,
    sig: signed.signature,
    timeout_seconds: timeoutSeconds,
  });
  const { paymentHeader, segmentHeader } = await getStartPaymentHeaders(
    session,
    paymentInfo,
    config.capabilityName,
    true,
  );
  const headers: Record<string, string> = { Livepeer: signedJobHeader };
  if (paymentHeader) {
    headers["Livepeer-Payment"] = paymentHeader;
    headers["Livepeer-Segment"] = segmentHeader;
  }
  const startUrl = resolveTranscoderHttpUrl(
    getTranscoderUrl(paymentInfo),
    req.streamStartEndpoint ?? "/ai/stream/start",
  );
  const data = await postStartWithPaymentRetry({
    startUrl,
    startPayload,
    headers,
    signedJobHeader,
    timeoutSeconds,
    session,
    paymentInfo,
    capabilityName: config.capabilityName,
    fetchImpl: config.fetchImpl,
  });
  const responseHeaders = data.headers;

  return {
    job: {
      jobId,
      capability: config.capabilityName,
      publishUrl: headerGet(responseHeaders, "X-Publish-Url"),
      subscribeUrl: headerGet(responseHeaders, "X-Subscribe-Url"),
      controlUrl: headerGet(responseHeaders, "X-Control-Url"),
      eventsUrl: headerGet(responseHeaders, "X-Events-Url"),
      dataUrl: headerGet(responseHeaders, "X-Data-Url"),
      status: "running",
    },
    signedJobHeader,
    streamStopUrl: deriveStreamStopUrl(startUrl, jobId),
    paymentSession: session,
  };
}

export async function startByocJob(
  req: BYOCJobRequestInput,
  options: StartByocOptions = {},
): Promise<StartedBYOCJob> {
  const config = resolveByocStartConfig(req, options);
  const cursor = await orchestratorSelector({
    orchestrators: config.orchestrators,
    signerUrl: config.signerUrl,
    signerHeaders: config.signerHeaders,
    discoveryUrl: config.discoveryUrl,
    discoveryHeaders: config.discoveryHeaders,
    capabilities: config.capabilities,
    useTofu: config.useTofu,
    fetchImpl: config.fetchImpl,
  });

  const startRejections: Array<{ url: string; reason: string }> = [];
  while (true) {
    let selectedUrl: string;
    try {
      [selectedUrl] = await cursor.next();
    } catch (error) {
      if (error instanceof NoOrchestratorAvailableError) {
        const all = [...error.rejections, ...startRejections];
        if (all.length > 0) {
          throw new NoOrchestratorAvailableError(
            `All orchestrators failed (${all.length} tried)`,
            all,
          );
        }
      }
      throw error;
    }

    try {
      return await startSelectedByocJob(selectedUrl, req, config);
    } catch (error) {
      startRejections.push({
        url: selectedUrl,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
