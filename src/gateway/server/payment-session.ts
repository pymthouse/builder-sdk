import type { OrchestratorInfoMessage } from "./grpc-loader.js";
import { httpOrigin, insecureFetch, readJsonResponse, signerRequestUrl } from "./http-insecure.js";
import { getOrchestratorInfo, serializeOrchestratorInfo } from "./orch-grpc.js";
import { encodeCapabilitiesBase64 } from "./grpc-loader.js";

export type PaymentHeaders = {
  payment: string;
  segCreds: string;
};

export class PaymentSession {
  private manifestId: string | null = null;
  private state: Record<string, string> | null = null;
  private orchestratorInfo: OrchestratorInfoMessage;

  constructor(
    private readonly signerUrl: string,
    orchestratorInfo: OrchestratorInfoMessage,
    private readonly signerHeaders: Record<string, string> | undefined,
    private readonly modelId: string,
    private readonly useTofu: boolean,
  ) {
    this.orchestratorInfo = orchestratorInfo;
  }

  setManifestId(manifestId: string): void {
    this.manifestId = manifestId.trim();
  }

  get transcoderUrl(): string {
    const url = this.orchestratorInfo.transcoder?.trim();
    if (!url) {
      throw new Error("OrchestratorInfo missing transcoder URL");
    }
    return url;
  }

  async getPaymentHeaders(): Promise<PaymentHeaders> {
    if (!this.signerUrl.trim()) {
      return { payment: "", segCreds: "" };
    }

    let attempts = 0;
    while (true) {
      try {
        return await this.requestPayment();
      } catch (err) {
        if (attempts >= 3 || !(err instanceof SignerRefreshRequired)) {
          throw err;
        }
        this.orchestratorInfo = await getOrchestratorInfo({
          orchUrl: this.transcoderUrl,
          signerUrl: this.signerUrl,
          signerHeaders: this.signerHeaders,
          modelId: this.modelId,
          useTofu: this.useTofu,
        });
        attempts += 1;
      }
    }
  }

  async sendPayment(orchestratorUrl?: string): Promise<void> {
    const headers = await this.getPaymentHeaders();
    const target = orchestratorUrl?.trim() || this.transcoderUrl;
    const url = `${httpOrigin(target)}/payment`;
    const response = await insecureFetch(url, {
      method: "POST",
      headers: {
        "Livepeer-Payment": headers.payment,
        "Livepeer-Segment": headers.segCreds,
      },
      body: Buffer.alloc(0),
      timeoutMs: 5_000,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Payment POST failed HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
  }

  private async requestPayment(): Promise<PaymentHeaders> {
    const url = signerRequestUrl(this.signerUrl, "generate-live-payment");
    const orchB64 = serializeOrchestratorInfo(this.orchestratorInfo).toString("base64");
    const capsB64 = encodeCapabilitiesBase64(this.modelId);

    const payload: Record<string, unknown> = {
      orchestrator: orchB64,
      type: "lv2v",
      capabilities: capsB64,
    };
    if (this.manifestId) {
      payload.ManifestID = this.manifestId;
    }
    if (this.state) {
      payload.state = this.state;
    }

    const response = await insecureFetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...this.signerHeaders,
      },
      body: Buffer.from(JSON.stringify(payload)),
      timeoutMs: 10_000,
    });

    if (response.status === 480) {
      const orchHeader = response.headers.get("Livepeer-Orchestrator-URL")?.trim();
      throw new SignerRefreshRequired(orchHeader ?? "");
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`generate-live-payment HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = await readJsonResponse<{
      payment?: string;
      segCreds?: string;
      state?: Record<string, string>;
    }>(response);

    const payment = data.payment ?? "";
    const segCreds = data.segCreds ?? "";
    if (!payment) {
      throw new Error("generate-live-payment missing payment field");
    }
    if (!data.state || typeof data.state !== "object") {
      throw new Error("generate-live-payment missing state object");
    }
    this.state = data.state;
    return { payment, segCreds };
  }
}

export class SignerRefreshRequired extends Error {
  constructor(readonly orchestratorUrl: string) {
    super("Signer refresh required (HTTP 480)");
    this.name = "SignerRefreshRequired";
  }
}
