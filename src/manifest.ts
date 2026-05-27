import { createHash } from "node:crypto";

import type { AppManifestCapability, AppManifestResponse } from "./types.js";

export function parseAppManifestResponse(json: unknown): AppManifestResponse {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { capabilities: [], excludedCapabilities: [] };
  }
  const record = json as Record<string, unknown>;
  const capabilities = parseCapabilityArray(record.capabilities);
  const excludedCapabilities = parseCapabilityArray(record.excludedCapabilities);
  const manifestVersion =
    typeof record.manifestVersion === "string" && record.manifestVersion.trim()
      ? record.manifestVersion.trim()
      : undefined;
  return { capabilities, excludedCapabilities, manifestVersion };
}

function parseCapabilityArray(raw: unknown): AppManifestCapability[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is AppManifestCapability =>
      !!c &&
      typeof c === "object" &&
      typeof (c as { pipeline?: unknown }).pipeline === "string" &&
      typeof (c as { modelId?: unknown }).modelId === "string",
  );
}

function sortedCaps(caps: AppManifestCapability[]): AppManifestCapability[] {
  return [...caps].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    return p === 0 ? a.modelId.localeCompare(b.modelId) : p;
  });
}

export function computeManifestRevision(
  data: Pick<
    AppManifestResponse,
    "capabilities" | "excludedCapabilities" | "manifestVersion"
  > | null,
): string {
  if (data == null) {
    return "unavailable";
  }
  if (data.manifestVersion?.trim()) {
    return data.manifestVersion.trim();
  }
  const caps = sortedCaps(data.capabilities ?? []);
  const excl = sortedCaps(data.excludedCapabilities ?? []);
  if (caps.length === 0 && excl.length === 0) {
    return "empty";
  }
  return createHash("sha256")
    .update(JSON.stringify({ capabilities: caps, excludedCapabilities: excl }))
    .digest("hex")
    .slice(0, 24);
}
