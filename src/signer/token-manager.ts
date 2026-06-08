import type { CachedSignerToken, SignerTokenManagerOptions } from "./types.js";

function cacheKey(clientId: string, externalUserId: string): string {
  return `${clientId}\0${externalUserId}`;
}

export interface SignerTokenManager {
  getToken(
    publicClientId: string,
    externalUserId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<CachedSignerToken>;
  invalidate(publicClientId: string, externalUserId: string): void;
  peek(publicClientId: string, externalUserId: string): CachedSignerToken | undefined;
}

export function createSignerTokenManager(options: SignerTokenManagerOptions): SignerTokenManager {
  const ttlRefreshRatio = options.ttlRefreshRatio ?? 0.8;
  const cache = new Map<string, CachedSignerToken>();
  const inflight = new Map<string, Promise<CachedSignerToken>>();

  function isUsable(entry: CachedSignerToken, now: number, forceRefresh: boolean): boolean {
    if (forceRefresh) return false;
    if (now >= entry.expiresAt) return false;
    if (now >= entry.refreshAt) return false;
    return true;
  }

  async function refresh(
    publicClientId: string,
    externalUserId: string,
  ): Promise<CachedSignerToken> {
    const key = cacheKey(publicClientId, externalUserId);
    const existing = inflight.get(key);
    if (existing) {
      return existing;
    }

    const promise = options
      .mint(externalUserId)
      .then((token) => {
        const normalized: CachedSignerToken = {
          ...token,
          refreshAt:
            token.refreshAt ||
            Date.now() + Math.floor((token.expiresAt - Date.now()) * ttlRefreshRatio),
        };
        cache.set(key, normalized);
        inflight.delete(key);
        return normalized;
      })
      .catch((error: unknown) => {
        inflight.delete(key);
        throw error;
      });

    inflight.set(key, promise);
    return promise;
  }

  return {
    peek(publicClientId, externalUserId) {
      return cache.get(cacheKey(publicClientId, externalUserId));
    },

    invalidate(publicClientId, externalUserId) {
      const key = cacheKey(publicClientId, externalUserId);
      cache.delete(key);
      inflight.delete(key);
    },

    async getToken(publicClientId, externalUserId, getOptions = {}) {
      const now = Date.now();
      const key = cacheKey(publicClientId, externalUserId);
      const cached = cache.get(key);
      if (cached && isUsable(cached, now, getOptions.forceRefresh === true)) {
        return cached;
      }

      return refresh(publicClientId, externalUserId);
    },
  };
}
