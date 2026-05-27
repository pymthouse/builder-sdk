import {
  GatewayError,
  NoOrchestratorAvailableError,
  type OrchestratorRejection,
} from "./errors.js";
import { getOrchInfo } from "./orch-info.js";
import { discoverOrchestrators } from "./orchestrator.js";
import type { CapabilitiesMessage } from "./capabilities.js";
import type { OrchestratorInfoMessage } from "./types.js";

const BATCH_SIZE = 5;

export class SelectionCursor {
  private readonly orchList: string[];
  private readonly signerUrl?: string;
  private readonly signerHeaders?: Record<string, string>;
  private readonly capabilities?: CapabilitiesMessage | null;
  private readonly useTofu: boolean;
  private readonly fetchImpl?: typeof fetch;
  private batchStart = 0;
  private pendingSuccesses: Array<[string, OrchestratorInfoMessage]> = [];
  readonly rejections: OrchestratorRejection[] = [];

  constructor(
    orchList: string[],
    options: {
      signerUrl?: string;
      signerHeaders?: Record<string, string>;
      capabilities?: CapabilitiesMessage | null;
      useTofu?: boolean;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.orchList = orchList;
    this.signerUrl = options.signerUrl;
    this.signerHeaders = options.signerHeaders;
    this.capabilities = options.capabilities;
    this.useTofu = options.useTofu ?? true;
    this.fetchImpl = options.fetchImpl;
  }

  async next(): Promise<[string, OrchestratorInfoMessage]> {
    while (true) {
      if (this.pendingSuccesses.length > 0) {
        return this.pendingSuccesses.shift()!;
      }
      if (this.batchStart >= this.orchList.length) {
        throw new NoOrchestratorAvailableError(
          `All orchestrators failed (${this.rejections.length} tried)`,
          [...this.rejections],
        );
      }
      await this.populateNextBatchSuccesses();
    }
  }

  private async populateNextBatchSuccesses(): Promise<void> {
    const batch = this.orchList.slice(this.batchStart, this.batchStart + BATCH_SIZE);
    this.batchStart += BATCH_SIZE;

    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const info = await getOrchInfo({
            orchUrl: url,
            signerUrl: this.signerUrl,
            signerHeaders: this.signerHeaders,
            capabilities: this.capabilities,
            useTofu: this.useTofu,
            fetchImpl: this.fetchImpl,
          });
          return { ok: true as const, url, info };
        } catch (error) {
          return {
            ok: false as const,
            url,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    for (const result of results) {
      if (result.ok) {
        this.pendingSuccesses.push([result.url, result.info]);
      } else {
        this.rejections.push({ url: result.url, reason: result.reason });
      }
    }
  }
}

export async function orchestratorSelector(options: {
  orchestrators?: string | string[] | null;
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  capabilities?: CapabilitiesMessage | null;
  useTofu?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<SelectionCursor> {
  const orchList = await discoverOrchestrators(options);
  if (orchList.length === 0) {
    throw new NoOrchestratorAvailableError("No orchestrators available to select");
  }
  return new SelectionCursor(orchList, options);
}
