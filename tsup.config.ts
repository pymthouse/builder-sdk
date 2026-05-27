import { defineConfig } from "tsup";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

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
    "gateway/browser": "src/gateway/browser.ts",
    "gateway/ui": "src/gateway/ui.ts",
    "gateway/server": "src/gateway/server.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: ["@grpc/grpc-js", "@grpc/proto-loader", "ws"],
  onSuccess: async () => {
    const outDir = join(rootDir, "dist/gateway/proto");
    mkdirSync(outDir, { recursive: true });
    copyFileSync(
      join(rootDir, "src/gateway/proto/lp_rpc.proto"),
      join(outDir, "lp_rpc.proto"),
    );
  },
});
