import { httpOrigin, insecureFetch, readJsonResponse } from "./http-insecure.js";

export type SignerMaterial = {
  address: string;
  sig: string;
};

const signerMaterialCache = new Map<string, SignerMaterial>();

function cacheKey(signerUrl: string, headers?: Record<string, string>): string {
  const headerPart = headers
    ? JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
    : "";
  return `${httpOrigin(signerUrl)}|${headerPart}`;
}

export async function getSignerMaterial(
  signerUrl: string,
  signerHeaders?: Record<string, string>,
): Promise<SignerMaterial> {
  if (!signerUrl.trim()) {
    return { address: "", sig: "" };
  }

  const key = cacheKey(signerUrl, signerHeaders);
  const cached = signerMaterialCache.get(key);
  if (cached) {
    return cached;
  }

  const url = `${httpOrigin(signerUrl)}/sign-orchestrator-info`;
  const response = await insecureFetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...signerHeaders,
    },
    body: Buffer.from("{}"),
    timeoutMs: 5_000,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Signer error HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await readJsonResponse<{ address?: string; signature?: string }>(response);
  const address = data.address?.trim() ?? "";
  const sig = data.signature?.trim() ?? "";
  if (!address || !sig) {
    throw new Error("Signer response missing address or signature");
  }

  const material = { address, sig };
  signerMaterialCache.set(key, material);
  return material;
}

function hexToBytes(hex: string): Buffer {
  let value = hex.trim();
  if (value.startsWith("0x") || value.startsWith("0X")) {
    value = value.slice(2);
  }
  if (value.length % 2 === 1) {
    value = `0${value}`;
  }
  return Buffer.from(value, "hex");
}

export function signerMaterialToGrpcFields(material: SignerMaterial): {
  address: Buffer;
  sig: Buffer;
} {
  return {
    address: hexToBytes(material.address),
    sig: hexToBytes(material.sig),
  };
}
