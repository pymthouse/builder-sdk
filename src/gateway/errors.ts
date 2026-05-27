export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface OrchestratorRejection {
  url: string;
  reason: string;
}

export class NoOrchestratorAvailableError extends GatewayError {
  readonly rejections: OrchestratorRejection[];

  constructor(message: string, rejections: OrchestratorRejection[] = []) {
    super(message, "no_orchestrator");
    this.name = "NoOrchestratorAvailableError";
    this.rejections = rejections;
  }
}

export class SignerRefreshRequired extends GatewayError {
  constructor(message: string) {
    super(message, "signer_refresh_required");
    this.name = "SignerRefreshRequired";
  }
}

export class SkipPaymentCycle extends GatewayError {
  constructor(message: string) {
    super(message, "skip_payment_cycle");
    this.name = "SkipPaymentCycle";
  }
}

export class PaymentRequiredError extends GatewayError {
  constructor(message: string) {
    super(message, "payment_required");
    this.name = "PaymentRequiredError";
  }
}

export class PaymentError extends GatewayError {
  constructor(message: string) {
    super(message, "payment_error");
    this.name = "PaymentError";
  }
}

export class RemoteSignerError extends GatewayError {
  constructor(
    readonly signerUrl: string,
    message: string,
  ) {
    super(`Remote signer error: ${message} (url=${signerUrl})`, "remote_signer");
    this.name = "RemoteSignerError";
  }
}

export class OrchestratorRpcError extends GatewayError {
  constructor(
    readonly orchUrl: string,
    message: string,
  ) {
    super(`Orchestrator RPC error: ${message} (orch=${orchUrl})`, "orchestrator_rpc");
    this.name = "OrchestratorRpcError";
  }
}
