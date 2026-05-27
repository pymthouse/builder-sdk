import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    format: "src/format.ts",
    env: "src/env.ts",
    config: "src/config.ts",
    tokens: "src/tokens.ts",
    device: "src/device.ts",
    "device-initiate": "src/device-initiate.ts",
    verify: "src/verify.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
});
