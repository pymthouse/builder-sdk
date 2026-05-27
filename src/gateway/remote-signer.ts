import { RemoteSignerError } from "./errors.js";
import { joinSignerEndpoint, postJson } from "./http.js";
import type { GetPaymentResponse } from "./types.js";

export interface SignerMaterial {
  address: Buffer;
  sig: Buffer;
}

const signerCache = new Map<string, SignerMaterial>();

function cacheKey(signerUrl: string, headers?: Record<string, string>): string {
  const headerPart = headers
    ? JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
    : "";
  return `${signerUrl}\0${headerPart}`;
}

function hexToBytes(value: string, expectedLen?: number): Buffer {
  let s = value.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (s.length % 2 === 1) s = `0${s}`;
  const buf = Buffer.from(s, "hex");
  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new Error(`Expected ${expectedLen} bytes, got ${buf.length} bytes`);
  }
  return buf;
}

export async function getOrchInfoSig(
  signerUrl: string,
  signerHeaders?: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<SignerMaterial> {
  if (!signerUrl) {
    return { address: Buffer.alloc(0), sig: Buffer.alloc(0) };
  }

  const key = cacheKey(signerUrl, signerHeaders);
  const cached = signerCache.get(key);
  if (cached) return cached;

  const endpointUrl = joinSignerEndpoint(signerUrl, "/sign-orchestrator-info");
  let data: Record<string, unknown>;
  try {
    data = await postJson(endpointUrl, {}, { headers: signerHeaders, fetchImpl });
  } catch (error) {
    throw new RemoteSignerError(
      endpointUrl,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (typeof data.address !== "string" || typeof data.signature !== "string") {
    throw new RemoteSignerError(
      endpointUrl,
      `Remote signer JSON must contain 'address' and 'signature': ${JSON.stringify(data)}`,
    );
  }

  const material: SignerMaterial = {
    address: hexToBytes(data.address, 20),
    sig: hexToBytes(data.signature),
  };
  signerCache.set(key, material);
  return material;
}

export function clearSignerCache(): void {
  signerCache.clear();
}

export async function generateLivePayment(
  signerUrl: string,
  payload: Record<string, unknown>,
  signerHeaders?: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<GetPaymentResponse & { state: Record<string, unknown> }> {
  const url = joinSignerEndpoint(signerUrl, "/generate-live-payment");
  const data = await postJson(url, payload, { headers: signerHeaders, fetchImpl });
  const payment = data.payment;
  if (typeof payment !== "string" || !payment) {
    throw new Error(`GetPayment error: missing/invalid 'payment' in response (url=${url})`);
  }
  const segCreds = data.segCreds;
  if (segCreds !== undefined && typeof segCreds !== "string") {
    throw new Error(`GetPayment error: invalid 'segCreds' in response (url=${url})`);
  }
  const state = data.state;
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error(`Remote signer response missing 'state' object (url=${url})`);
  }
  return {
    payment,
    segCreds: typeof segCreds === "string" ? segCreds : undefined,
    state: state as Record<string, unknown>,
  };
}

export async function signByocJobRemote(
  signerUrl: string,
  payload: Record<string, unknown>,
  signerHeaders?: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<{ sender: string; signature: string }> {
  const url = joinSignerEndpoint(signerUrl, "/sign-byoc-job");
  const data = await postJson(url, payload, { headers: signerHeaders, fetchImpl });
  const sender = data.sender;
  const signature = data.signature;
  if (typeof sender !== "string" || !sender) {
    throw new Error(`Invalid signer response: missing sender (url=${url})`);
  }
  if (typeof signature !== "string" || !signature) {
    throw new Error(`Invalid signer response: missing signature (url=${url})`);
  }
  return { sender, signature };
}
