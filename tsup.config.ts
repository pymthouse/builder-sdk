import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "plan-pricing": "src/plan-pricing.ts",
    format: "src/format.ts",
    env: "src/env.ts",
    config: "src/config.ts",
    tokens: "src/tokens.ts",
    device: "src/device.ts",
    "device-initiate": "src/device-initiate.ts",
    verify: "src/verify.ts",
    "signer/server": "src/signer/server.ts",
    "signer/webhook": "src/signer/webhook/index.ts",
    "signer/webhook/adapters/api-key":
      "src/signer/webhook/adapters/api-key/index.ts",
    "signer/webhook/adapters/composite":
      "src/signer/webhook/adapters/composite/index.ts",
    "signer/webhook/adapters/oidc":
      "src/signer/webhook/adapters/oidc/index.ts",
    "signer/webhook/adapters/oauth1":
      "src/signer/webhook/adapters/oauth1/index.ts",
    "signer/webhook/adapters/trusted-headers":
      "src/signer/webhook/adapters/trusted-headers/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
});
