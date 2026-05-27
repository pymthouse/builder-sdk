/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { computeManifestRevision, parseAppManifestResponse } from "../src/manifest.js";

describe("manifest", () => {
  it("parseAppManifestResponse filters invalid capability rows", () => {
    const parsed = parseAppManifestResponse({
      capabilities: [{ pipeline: "p", modelId: "m" }, { pipeline: "bad" }],
      excludedCapabilities: [{ pipeline: "x", modelId: "y" }],
      manifestVersion: "v1",
    });
    expect(parsed.capabilities).toEqual([{ pipeline: "p", modelId: "m" }]);
    expect(parsed.manifestVersion).toBe("v1");
  });

  it("computeManifestRevision prefers manifestVersion", () => {
    expect(
      computeManifestRevision({
        capabilities: [],
        manifestVersion: "rev-abc",
      }),
    ).toBe("rev-abc");
  });

  it("computeManifestRevision hashes capabilities when version absent", () => {
    const a = computeManifestRevision({
      capabilities: [{ pipeline: "a", modelId: "b" }],
      excludedCapabilities: [],
    });
    const b = computeManifestRevision({
      capabilities: [{ pipeline: "a", modelId: "b" }],
      excludedCapabilities: [],
    });
    expect(a).toBe(b);
    expect(a).not.toBe("empty");
  });
});
