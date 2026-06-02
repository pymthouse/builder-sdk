import tls from "node:tls";

const tofuCache = new Map<string, { rootPem: Buffer; authority: string }>();

function splitHostPort(target: string): { host: string; port: number } {
  const trimmed = target.trim();
  if (trimmed.startsWith("[")) {
    const host = trimmed.slice(1, trimmed.indexOf("]"));
    const port = Number(trimmed.slice(trimmed.indexOf("]") + 2));
    return { host, port };
  }
  const [host, portRaw] = trimmed.split(":");
  return { host, port: Number(portRaw) };
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function pickCertAuthority(cert: tls.PeerCertificate): string {
  const san = cert.subjectaltname?.split(", ").map((entry) => {
    const [typ, val] = entry.split(":");
    return { typ, val };
  });
  if (san) {
    for (const entry of san) {
      if (entry.typ === "DNS" && entry.val) {
        return entry.val;
      }
    }
    for (const entry of san) {
      if (entry.typ === "IP" && entry.val) {
        return entry.val;
      }
    }
  }
  const cn = cert.subject?.CN;
  if (cn) {
    return cn;
  }
  return "";
}

async function fetchTofuRootCert(target: string): Promise<{ rootPem: Buffer; authority: string }> {
  const { host, port } = splitHostPort(target);
  return new Promise((resolve, reject) => {
    const servername = isIpAddress(host) ? undefined : host;
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
        socket.end();
        if (!peer?.raw) {
          reject(new Error("No peer certificate"));
          return;
        }
        const pem = `-----BEGIN CERTIFICATE-----\n${peer.raw
          .toString("base64")
          .match(/.{1,64}/g)
          ?.join("\n")}\n-----END CERTIFICATE-----\n`;
        const authority = pickCertAuthority(peer) || host;
        resolve({ rootPem: Buffer.from(pem), authority });
      },
    );
    socket.on("error", reject);
    socket.setTimeout(5000, () => {
      socket.destroy(new Error("TLS probe timeout"));
    });
  });
}

export function parseGrpcTarget(orchUrl: string): string {
  const url = orchUrl.includes("://") ? orchUrl : `https://${orchUrl}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Only https orchestrator URLs are supported (got ${parsed.protocol})`);
  }
  return parsed.host;
}

export async function trustOnFirstUse(target: string): Promise<{
  rootPem: Buffer;
  authority: string;
}> {
  const cached = tofuCache.get(target);
  if (cached) {
    return cached;
  }
  const material = await fetchTofuRootCert(target);
  tofuCache.set(target, material);
  return material;
}

export function evictTofuCache(target: string): void {
  tofuCache.delete(target);
}

export function isCertVerifyError(message: string): boolean {
  return message.includes("CERTIFICATE_VERIFY_FAILED");
}
