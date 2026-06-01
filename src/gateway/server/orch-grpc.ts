import { buildLv2vCapabilitiesMessage } from "./capabilities.js";
import {
  loadOrchestratorGrpc,
  loadProtoRoot,
  type OrchestratorInfoMessage,
} from "./grpc-loader.js";
import { getSignerMaterial, signerMaterialToGrpcFields } from "./signer-material.js";
import {
  evictTofuCache,
  isCertVerifyError,
  parseGrpcTarget,
  trustOnFirstUse,
} from "./tofu.js";

export async function getOrchestratorInfo(input: {
  orchUrl: string;
  signerUrl: string;
  signerHeaders?: Record<string, string>;
  modelId: string;
  useTofu?: boolean;
}): Promise<OrchestratorInfoMessage> {
  const useTofu = input.useTofu !== false;
  const target = parseGrpcTarget(input.orchUrl);
  const signer = await getSignerMaterial(input.signerUrl, input.signerHeaders);
  const { address, sig } = signerMaterialToGrpcFields(signer);

  const request = {
    address,
    sig,
    capabilities: buildLv2vCapabilitiesMessage(input.modelId),
    ignoreCapacityCheck: true,
  };

  const maxAttempts = useTofu ? 2 : 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await callGetOrchestrator(target, request, useTofu);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (useTofu && attempt === 0 && isCertVerifyError(lastError.message)) {
        evictTofuCache(target);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("GetOrchestrator failed");
}

function callGetOrchestrator(
  target: string,
  request: Record<string, unknown>,
  useTofu: boolean,
): Promise<OrchestratorInfoMessage> {
  return new Promise((resolve, reject) => {
    void (async () => {
      try {
        const { grpc, Orchestrator } = loadOrchestratorGrpc();
        let credentials: ReturnType<typeof grpc.credentials.createSsl>;
        let options: Record<string, unknown> = {};

        if (useTofu) {
          const { rootPem, authority } = await trustOnFirstUse(target);
          credentials = grpc.credentials.createSsl(rootPem);
          options = {
            "grpc.ssl_target_name_override": authority,
            "grpc.default_authority": authority,
          };
        } else {
          credentials = grpc.credentials.createSsl();
        }

        const client = new Orchestrator(target, credentials, options);
        client.GetOrchestrator(request, (err, response) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(response);
        });
      } catch (e) {
        reject(e);
      }
    })();
  });
}

export function serializeOrchestratorInfo(info: OrchestratorInfoMessage): Buffer {
  if (typeof info.SerializeToString === "function") {
    return Buffer.from(info.SerializeToString());
  }

  // @grpc/proto-loader returns plain objects without SerializeToString.
  const { root } = loadProtoRoot();
  return Buffer.from(root.net.OrchestratorInfo.serialize(info as Record<string, unknown>));
}
