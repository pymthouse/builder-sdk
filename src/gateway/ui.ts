import { PmtHouseGatewayClient } from "./browser.js";
import type { BYOCJobRecord } from "./types.js";

const ELEMENT_TAG = "pymthouse-gateway";

export class PmtHouseGatewayElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["capability", "base-path", "access-token", "request", "parameters"];
  }

  private client: PmtHouseGatewayClient | null = null;
  private currentJobId: string | null = null;
  private eventsAbort: AbortController | null = null;

  connectedCallback(): void {
    if (!this.querySelector(".pymthouse-gateway-shell")) {
      this.renderShell();
    }
    this.syncClient();
  }

  disconnectedCallback(): void {
    this.eventsAbort?.abort();
  }

  attributeChangedCallback(): void {
    this.syncClient();
  }

  get capability(): string {
    return this.getAttribute("capability") ?? "";
  }

  set capability(value: string) {
    this.setAttribute("capability", value);
  }

  get basePath(): string {
    return this.getAttribute("base-path") ?? "/pymthouse/gateway";
  }

  set basePath(value: string) {
    this.setAttribute("base-path", value);
  }

  get accessToken(): string {
    return this.getAttribute("access-token") ?? "";
  }

  set accessToken(value: string) {
    this.setAttribute("access-token", value);
  }

  async start(): Promise<BYOCJobRecord | null> {
    this.syncClient();
    if (!this.client || !this.capability.trim()) {
      this.dispatchError("capability is required");
      return null;
    }

    try {
      this.setStatus("starting…");
      const started = await this.client.startJob({
        capability: this.capability.trim(),
        request: this.readJsonAttribute("request"),
        parameters: this.readJsonAttribute("parameters"),
      });
      this.currentJobId = started.job.jobId;
      this.setStatus(`running (${started.job.jobId})`);
      this.dispatchEvent(
        new CustomEvent("pymthouse-job-start", {
          detail: { job: started.job },
          bubbles: true,
        }),
      );
      void this.listenForEvents(started.job.jobId);
      return started.job;
    } catch (error) {
      this.dispatchError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async sendControl(payload: Record<string, unknown>): Promise<void> {
    if (!this.client || !this.currentJobId) {
      this.dispatchError("No active job");
      return;
    }
    await this.client.sendControl(this.currentJobId, payload);
  }

  async stop(): Promise<void> {
    if (!this.client || !this.currentJobId) return;
    try {
      const result = await this.client.stopJob(this.currentJobId);
      this.setStatus("stopped");
      this.dispatchEvent(
        new CustomEvent("pymthouse-job-stop", {
          detail: { jobId: this.currentJobId, statusCode: result.status_code },
          bubbles: true,
        }),
      );
    } catch (error) {
      this.dispatchError(error instanceof Error ? error.message : String(error), this.currentJobId);
    } finally {
      this.eventsAbort?.abort();
      this.currentJobId = null;
    }
  }

  private syncClient(): void {
    this.client = new PmtHouseGatewayClient({
      basePath: this.basePath,
      accessToken: this.accessToken || undefined,
    });
  }

  private readJsonAttribute(name: string): Record<string, unknown> | undefined {
    const raw = this.getAttribute(name);
    if (!raw?.trim()) return undefined;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private async listenForEvents(jobId: string): Promise<void> {
    if (!this.client) return;
    this.eventsAbort?.abort();
    this.eventsAbort = new AbortController();
    try {
      for await (const data of this.client.events(jobId, this.eventsAbort.signal)) {
        this.dispatchEvent(
          new CustomEvent("pymthouse-job-event", {
            detail: { jobId, data },
            bubbles: true,
          }),
        );
      }
    } catch (error) {
      if (this.eventsAbort.signal.aborted) return;
      this.dispatchError(error instanceof Error ? error.message : String(error), jobId);
    }
  }

  private renderShell(): void {
    this.innerHTML = `
      <section class="pymthouse-gateway-shell" part="shell">
        <header part="header">
          <strong part="title">PymtHouse Gateway</strong>
          <span part="status" data-status>idle</span>
        </header>
        <div part="actions">
          <button type="button" part="start-button" data-start>Start</button>
          <button type="button" part="stop-button" data-stop>Stop</button>
        </div>
        <slot part="content"></slot>
      </section>
    `;
    this.querySelector("[data-start]")?.addEventListener("click", () => {
      void this.start();
    });
    this.querySelector("[data-stop]")?.addEventListener("click", () => {
      void this.stop();
    });
  }

  private setStatus(value: string): void {
    const el = this.querySelector("[data-status]");
    if (el) el.textContent = value;
  }

  private dispatchError(error: string, jobId?: string | null): void {
    this.setStatus("error");
    this.dispatchEvent(
      new CustomEvent("pymthouse-job-error", {
        detail: { jobId: jobId ?? undefined, error },
        bubbles: true,
      }),
    );
  }
}

export function definePmtHouseGatewayElement(tagName = ELEMENT_TAG): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tagName)) {
    customElements.define(tagName, PmtHouseGatewayElement);
  }
}

export { PmtHouseGatewayClient } from "./browser.js";
export type { GatewayEventMap } from "./types.js";
