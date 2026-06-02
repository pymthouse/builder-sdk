import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLv2vCapabilitiesMessage } from "./capabilities.js";

export type OrchestratorInfoMessage = {
  transcoder?: string;
  SerializeToString?: () => Uint8Array;
};

export type GrpcOrchestratorClient = {
  GetOrchestrator: (
    request: Record<string, unknown>,
    callback: (err: Error | null, response: OrchestratorInfoMessage) => void,
  ) => void;
};

type GrpcModule = typeof import("@grpc/grpc-js");
type ProtoLoaderModule = typeof import("@grpc/proto-loader");

type ProtoRoot = {
  net: {
    Orchestrator: new (
      target: string,
      credentials: ReturnType<GrpcModule["ChannelCredentials"]["createSsl"]>,
      options: Record<string, unknown>,
    ) => GrpcOrchestratorClient;
    Capabilities: {
      serialize: (payload: Record<string, unknown>) => Buffer;
    };
    OrchestratorInfo: {
      serialize: (payload: Record<string, unknown>) => Buffer;
    };
  };
};

let cachedRoot: ProtoRoot | null = null;

function protoPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../gateway/proto/lp_rpc.proto");
}

function requireGrpcPeer<T>(label: string, load: () => T): T {
  try {
    return load();
  } catch {
    throw new Error(
      `${label} is required for @pymthouse/builder-sdk/gateway/server. Install peer dependencies: @grpc/grpc-js @grpc/proto-loader`,
    );
  }
}

export function loadProtoRoot(): { grpc: GrpcModule; root: ProtoRoot } {
  const grpc = requireGrpcPeer("@grpc/grpc-js", () =>
    createRequire(import.meta.url)("@grpc/grpc-js"),
  ) as GrpcModule;
  if (cachedRoot) {
    return { grpc, root: cachedRoot };
  }

  const protoLoader = requireGrpcPeer("@grpc/proto-loader", () =>
    createRequire(import.meta.url)("@grpc/proto-loader"),
  ) as ProtoLoaderModule;

  const packageDefinition = protoLoader.loadSync(protoPath(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  cachedRoot = grpc.loadPackageDefinition(packageDefinition) as unknown as ProtoRoot;
  return { grpc, root: cachedRoot };
}

export function loadOrchestratorGrpc(): {
  grpc: GrpcModule;
  Orchestrator: ProtoRoot["net"]["Orchestrator"];
} {
  const { grpc, root } = loadProtoRoot();
  return { grpc, Orchestrator: root.net.Orchestrator };
}

export function encodeCapabilitiesBase64(modelId: string): string {
  const { root } = loadProtoRoot();
  const bytes = root.net.Capabilities.serialize(buildLv2vCapabilitiesMessage(modelId));
  return Buffer.from(bytes).toString("base64");
}
