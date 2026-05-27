import path from "node:path";
import { fileURLToPath } from "node:url";
import tls from "node:tls";
import net from "node:net";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import { OrchestratorRpcError } from "./errors.js";
import { getOrchInfoSig } from "./remote-signer.js";
import type { CapabilitiesMessage } from "./capabilities.js";
import type { OrchestratorInfoMessage } from "./types.js";

const tofuCache = new Map<string, { rootPem: Buffer; authority: string }>();

const protoPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "proto",
  "lp_rpc.proto",
);

let packageDefinition: protoLoader.PackageDefinition | null = null;
let grpcRoot: grpc.GrpcObject | null = null;

function loadGrpc(): grpc.GrpcObject {
  if (grpcRoot) return grpcRoot;
  packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  grpcRoot = grpc.loadPackageDefinition(packageDefinition);
  return grpcRoot;
}

type OrchestratorClient = grpc.Client & {
  GetOrchestrator: (
    request: Record<string, unknown>,
    callback: (error: grpc.ServiceError | null, response?: OrchestratorInfoMessage) => void,
  ) => void;
};

function getNetPackage(): {
  Orchestrator: grpc.ServiceClientConstructor;
  OrchestratorInfo: { encode: (message: OrchestratorInfoMessage) => { finish: () => Buffer } };
  Capabilities: { encode: (message: CapabilitiesMessage) => { finish: () => Buffer } };
} {
  const root = loadGrpc() as Record<string, unknown>;
  const net = root.net as {
    Orchestrator: grpc.ServiceClientConstructor;
    OrchestratorInfo: { encode: (message: OrchestratorInfoMessage) => { finish: () => Buffer } };
    Capabilities: { encode: (message: CapabilitiesMessage) => { finish: () => Buffer } };
  };
  return net;
}

export function encodeOrchestratorInfo(info: OrchestratorInfoMessage): string {
  const { OrchestratorInfo } = getNetPackage();
  return OrchestratorInfo.encode(info).finish().toString("base64");
}

export function encodeCapabilities(caps: CapabilitiesMessage): string {
  const { Capabilities } = getNetPackage();
  return Capabilities.encode(caps).finish().toString("base64");
}

function parseGrpcTarget(orchUrl: string): string {
  const trimmed = orchUrl.trim();
  const url = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Only https:// orchestrator URLs are supported (got ${parsed.protocol})`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`Orchestrator URL must not include a path/query/fragment: ${orchUrl}`);
  }
  return parsed.host;
}

function splitHostPort(target: string): { host: string; port: number } {
  if (target.startsWith("[")) {
    const end = target.indexOf("]");
    const host = target.slice(1, end);
    const port = Number(target.slice(end + 2));
    return { host, port };
  }
  const [host, portStr] = target.split(":");
  return { host, port: Number(portStr) };
}

function pickCertAuthority(cert: tls.PeerCertificate): string {
  const subjectaltname = cert.subjectaltname ?? "";
  for (const part of subjectaltname.split(", ")) {
    if (part.startsWith("DNS:")) return part.slice(4);
    if (part.startsWith("IP Address:")) return part.slice(11);
  }
  const subject = cert.subject as unknown;
  if (Array.isArray(subject)) {
    for (const rdn of subject) {
      if (!Array.isArray(rdn)) continue;
      for (const entry of rdn) {
        if (Array.isArray(entry) && entry[0] === "CN" && typeof entry[1] === "string") {
          return entry[1];
        }
      }
    }
  }
  return "";
}

async function fetchTofuRootCert(target: string): Promise<{ rootPem: Buffer; authority: string }> {
  const { host, port } = splitHostPort(target);
  const servername = net.isIP(host) ? undefined : host;

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername,
        rejectUnauthorized: false,
        ALPNProtocols: ["h2"],
      },
      () => {
        const peer = socket.getPeerCertificate();
        if (!peer?.raw) {
          socket.destroy();
          reject(new Error("Failed to read peer certificate"));
          return;
        }
        const rootPem = Buffer.from(
          `-----BEGIN CERTIFICATE-----\n${peer.raw.toString("base64")}\n-----END CERTIFICATE-----\n`,
        );
        const authority = pickCertAuthority(peer) || host;
        socket.end();
        resolve({ rootPem, authority });
      },
    );
    socket.on("error", reject);
  });
}

async function trustOnFirstUseRootCert(target: string): Promise<{ rootPem: Buffer; authority: string }> {
  const cached = tofuCache.get(target);
  if (cached) return cached;
  const material = await fetchTofuRootCert(target);
  tofuCache.set(target, material);
  return material;
}

function evictTofuCache(target: string): void {
  tofuCache.delete(target);
}

function isCertVerifyError(error: unknown): boolean {
  return String(error).includes("CERTIFICATE_VERIFY_FAILED");
}

function callGetOrchestrator(
  stub: OrchestratorClient,
  request: Record<string, unknown>,
  orchUrl: string,
): Promise<OrchestratorInfoMessage> {
  return new Promise((resolve, reject) => {
    stub.GetOrchestrator(request, (error, response) => {
      if (error) {
        reject(
          new OrchestratorRpcError(
            orchUrl,
            `${error.code ?? "UNKNOWN"}: ${error.details ?? error.message}`,
          ),
        );
        return;
      }
      resolve(response ?? {});
    });
  });
}

export async function getOrchInfo(options: {
  orchUrl: string;
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  capabilities?: CapabilitiesMessage | null;
  useTofu?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<OrchestratorInfoMessage> {
  const useTofu = options.useTofu ?? true;
  let signerMaterial;
  try {
    signerMaterial = await getOrchInfoSig(
      options.signerUrl ?? "",
      options.signerHeaders,
      options.fetchImpl,
    );
  } catch (error) {
    throw new OrchestratorRpcError(
      options.orchUrl,
      error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error),
    );
  }

  const request: Record<string, unknown> = {
    address: signerMaterial.address,
    sig: signerMaterial.sig,
    ignoreCapacityCheck: true,
  };
  if (options.capabilities) {
    request.capabilities = options.capabilities;
  }

  const target = parseGrpcTarget(options.orchUrl);
  const maxAttempts = useTofu ? 2 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let credentials: grpc.ChannelCredentials;
    let clientOptions: grpc.ClientOptions = {};
    if (useTofu) {
      const { rootPem, authority } = await trustOnFirstUseRootCert(target);
      credentials = grpc.credentials.createSsl(rootPem);
      clientOptions = {
        "grpc.ssl_target_name_override": authority,
        "grpc.default_authority": authority,
      };
    } else {
      credentials = grpc.credentials.createSsl();
    }

    const { Orchestrator } = getNetPackage();
    const client = new Orchestrator(
      target,
      credentials,
      clientOptions,
    ) as unknown as OrchestratorClient;
    try {
      return await callGetOrchestrator(client, request, options.orchUrl);
    } catch (error) {
      client.close();
      if (useTofu && attempt === 0 && isCertVerifyError(error)) {
        evictTofuCache(target);
        continue;
      }
      throw error;
    } finally {
      client.close();
    }
  }

  throw new OrchestratorRpcError(options.orchUrl, "Failed to fetch orchestrator info");
}

export function clearTofuCache(): void {
  tofuCache.clear();
}
