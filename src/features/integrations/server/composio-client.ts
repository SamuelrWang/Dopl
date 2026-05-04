import "server-only";
import { Composio } from "@composio/core";
import type { IntegrationObject, IntegrationProvider } from "../types";
import { IntegrationFetchError } from "./errors";
import {
  getProviderConfig,
  type ProviderListInput,
  type ProviderFetchInput,
} from "./providers";

/**
 * The only module that knows about the OAuth broker. Everything else
 * in the feature talks to this typed interface so:
 *   1. The broker can be swapped (Nango / Pipedream / native OAuth)
 *      without touching the service or the routes.
 *   2. Tests fake at the seam.
 *   3. The string "composio" exists in exactly one file outside of
 *      env-var names — making the "no broker brand leaks" audit a
 *      one-grep check.
 */
export type BrokerStatus = "connected" | "needs_auth" | "error";

export interface ComposioClient {
  initiateConnection(input: {
    entityId: string;
    authConfigId: string;
    callbackUrl: string;
  }): Promise<
    | { status: "connected"; brokerConnectionId: string }
    | { status: "needs_auth"; authUrl: string; brokerConnectionId: string }
  >;

  getConnectionStatus(brokerConnectionId: string): Promise<{ status: BrokerStatus }>;

  /**
   * Delete the broker-side connected account. Called from
   * `disconnectIntegration` so a subsequent `initiateConnection` for
   * the same entity+auth-config doesn't get rejected by Composio's
   * `allowMultiple=false` default.
   */
  deleteConnection(brokerConnectionId: string): Promise<void>;

  /**
   * Delete every broker connected_account belonging to the given
   * (entityId, authConfigId) pair. Called before `initiateConnection`
   * to self-heal from stuck multi-connection state — Composio rejects
   * fresh initiates when more than one account already exists for the
   * pair, and a previous disconnect that didn't reach the broker (or a
   * partial OAuth handshake) can leave orphans behind.
   *
   * Returns the count purged so the caller can log when it had work to do.
   */
  purgeAccountsFor(input: {
    entityId: string;
    authConfigId: string;
  }): Promise<number>;

  listObjects(input: {
    brokerConnectionId: string;
    provider: IntegrationProvider;
    listInput: ProviderListInput;
  }): Promise<{ objects: IntegrationObject[]; nextCursor: string | null }>;

  fetchObject(input: {
    brokerConnectionId: string;
    provider: IntegrationProvider;
    fetchInput: ProviderFetchInput;
  }): Promise<{
    title: string;
    url: string | null;
    body: string;
    lastModified: string | null;
  }>;
}

/**
 * Maps Composio's connection-status enum to our internal tri-state.
 * Composio uses INITIALIZING → INITIATED → ACTIVE for the happy path,
 * and FAILED / EXPIRED / INACTIVE for terminal failure modes.
 */
function mapBrokerStatus(raw: string | undefined | null): BrokerStatus {
  switch (raw) {
    case "ACTIVE":
      return "connected";
    case "INITIALIZING":
    case "INITIATED":
      return "needs_auth";
    case "FAILED":
    case "EXPIRED":
    case "INACTIVE":
    default:
      return "error";
  }
}

export function createComposioClient(opts: {
  apiKey: string;
}): ComposioClient {
  // The SDK is the source of truth for the wire format. Every method
  // below is a thin shim that maps SDK responses into our domain
  // shapes — no REST calls written by hand.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = new Composio({ apiKey: opts.apiKey }) as any;

  async function execute(
    provider: IntegrationProvider,
    slug: string,
    brokerConnectionId: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let response: { data: Record<string, unknown>; error: string | null; successful: boolean };
    try {
      response = await sdk.tools.execute(slug, {
        connectedAccountId: brokerConnectionId,
        arguments: args,
        // Pin to "latest" so the SDK doesn't reject a request when the
        // auth config has been upgraded server-side and the cached
        // version on disk is older. Composio recommends this for
        // server-side execute calls — see SDK docs on version param.
        version: "latest",
      });
    } catch (err) {
      throw new IntegrationFetchError(
        provider,
        err instanceof Error ? err.message : String(err)
      );
    }
    if (!response.successful) {
      throw new IntegrationFetchError(
        provider,
        response.error ?? "Tool execution failed"
      );
    }
    return response.data;
  }

  return {
    async initiateConnection({ entityId, authConfigId, callbackUrl }) {
      let request: {
        id: string;
        status?: string;
        redirectUrl?: string | null;
      };
      try {
        request = await sdk.connectedAccounts.initiate(entityId, authConfigId, {
          callbackUrl,
        });
      } catch (err) {
        throw new IntegrationFetchError(
          "notion",
          err instanceof Error ? err.message : String(err)
        );
      }
      const status = mapBrokerStatus(request.status);
      if (status === "connected") {
        return { status: "connected", brokerConnectionId: request.id };
      }
      if (!request.redirectUrl) {
        throw new IntegrationFetchError(
          "notion",
          "Broker returned a needs-auth state without a redirect URL"
        );
      }
      return {
        status: "needs_auth",
        authUrl: request.redirectUrl,
        brokerConnectionId: request.id,
      };
    },

    async getConnectionStatus(brokerConnectionId) {
      let account: { status?: string };
      try {
        account = await sdk.connectedAccounts.get(brokerConnectionId);
      } catch (err) {
        throw new IntegrationFetchError(
          "notion",
          err instanceof Error ? err.message : String(err)
        );
      }
      return { status: mapBrokerStatus(account.status) };
    },

    async deleteConnection(brokerConnectionId) {
      try {
        await sdk.connectedAccounts.delete(brokerConnectionId);
      } catch (err) {
        // Swallow — the broker-side cleanup is best-effort, and an
        // already-deleted connection shouldn't block the user from
        // disconnecting locally. Log via the caller, not here.
        const message = err instanceof Error ? err.message : String(err);
        if (!/not.?found|already/i.test(message)) {
          throw new IntegrationFetchError("notion", message);
        }
      }
    },

    async purgeAccountsFor({ entityId, authConfigId }) {
      let response: { items?: Array<{ id: string }> };
      try {
        response = await sdk.connectedAccounts.list({
          userIds: [entityId],
          authConfigIds: [authConfigId],
        });
      } catch (err) {
        // If we can't list, don't block initiate — the caller will
        // surface the real failure on its own attempt. Best-effort.
        const message = err instanceof Error ? err.message : String(err);
        if (!/not.?found/i.test(message)) {
          throw new IntegrationFetchError("notion", message);
        }
        return 0;
      }
      const items = response.items ?? [];
      let purged = 0;
      for (const item of items) {
        try {
          await sdk.connectedAccounts.delete(item.id);
          purged += 1;
        } catch {
          // Skip individual delete failures — already gone is fine.
        }
      }
      return purged;
    },

    async listObjects({ brokerConnectionId, provider, listInput }) {
      const cfg = getProviderConfig(provider);
      const args = cfg.buildListArgs(listInput);
      const data = await execute(provider, cfg.listActionSlug, brokerConnectionId, args);
      return cfg.parseListResponse(data);
    },

    async fetchObject({ brokerConnectionId, provider, fetchInput }) {
      const cfg = getProviderConfig(provider);
      const args = cfg.buildFetchArgs(fetchInput);
      const data = await execute(provider, cfg.fetchActionSlug, brokerConnectionId, args);
      return cfg.parseFetchResponse(data);
    },
  };
}

let cached: ComposioClient | null = null;
export function defaultComposioClient(): ComposioClient {
  if (cached) return cached;
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new IntegrationFetchError(
      "notion",
      "COMPOSIO_API_KEY is not configured on the server"
    );
  }
  cached = createComposioClient({ apiKey });
  return cached;
}
