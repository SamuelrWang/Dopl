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
    /**
     * When true, Composio allows multiple connected accounts for the
     * same (entityId, authConfigId) — required so users can connect
     * e.g. two Gmail accounts. Default in our flow.
     */
    allowMultiple?: boolean;
    /**
     * Optional human-readable label Composio attaches to the
     * connected account. We pass through whatever the user typed (or
     * a sentinel like "pending" before the OAuth completes); the
     * actual account-email-derived alias is filled in post-callback.
     */
    alias?: string;
  }): Promise<
    | { status: "connected"; brokerConnectionId: string }
    | { status: "needs_auth"; authUrl: string; brokerConnectionId: string }
  >;

  getConnectionStatus(brokerConnectionId: string): Promise<{ status: BrokerStatus }>;

  /**
   * Pull the broker's view of one connected account, including the
   * provider-specific state blob (which carries the authenticated
   * email address for Google providers, workspace info for Slack,
   * etc.). Used at callback time to derive a stable alias from the
   * account's email instead of asking the user to name it.
   *
   * Returns null fields when the broker doesn't expose an email/label
   * for the toolkit (rare but possible — some providers' state blobs
   * are opaque). Caller falls back to the connection id in that case.
   */
  getConnectedAccount(brokerConnectionId: string): Promise<{
    status: BrokerStatus;
    accountEmail: string | null;
    accountLabel: string | null;
  }>;

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
    entityId: string;
    provider: IntegrationProvider;
    listInput: ProviderListInput;
  }): Promise<{ objects: IntegrationObject[]; nextCursor: string | null }>;

  fetchObject(input: {
    brokerConnectionId: string;
    entityId: string;
    provider: IntegrationProvider;
    fetchInput: ProviderFetchInput;
  }): Promise<{
    title: string;
    url: string | null;
    body: string;
    lastModified: string | null;
  }>;

  executeAction(input: {
    brokerConnectionId: string;
    entityId: string;
    provider: IntegrationProvider;
    slug: string;
    arguments: Record<string, unknown>;
  }): Promise<{ raw: Record<string, unknown> }>;

  /**
   * Fetch every tool the broker exposes for one toolkit (e.g. "GMAIL").
   * Returns the slug, human-readable description, and full JSON-Schema
   * input shape — enough for `service.ts` to auto-generate action
   * descriptors without per-action hand-coding.
   */
  listToolkitTools(toolkitSlug: string): Promise<
    Array<{
      slug: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>
  >;
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
    entityId: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let response: { data: Record<string, unknown>; error: string | null; successful: boolean };
    try {
      response = await sdk.tools.execute(slug, {
        // Composio requires BOTH connectedAccountId and userId on
        // execute — error 1811 ("User ID is required with connected
        // account") fires when only the connection id is passed.
        // Our entityId is `${workspaceId}:${userId}`.
        connectedAccountId: brokerConnectionId,
        userId: entityId,
        arguments: args,
        // `version: "latest"` is type-allowed but rejected at runtime;
        // the documented escape hatch is `dangerouslySkipVersionCheck`.
        // We don't pin toolkit versions; we want whatever's current.
        dangerouslySkipVersionCheck: true,
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
    async initiateConnection({
      entityId,
      authConfigId,
      callbackUrl,
      allowMultiple,
      alias,
    }) {
      const opts: Record<string, unknown> = { callbackUrl };
      if (allowMultiple !== undefined) opts.allowMultiple = allowMultiple;
      if (alias !== undefined) opts.alias = alias;
      let request: {
        id: string;
        status?: string;
        redirectUrl?: string | null;
      };
      try {
        request = await sdk.connectedAccounts.initiate(
          entityId,
          authConfigId,
          opts
        );
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

    async getConnectedAccount(brokerConnectionId) {
      let account: {
        status?: string;
        // The broker's response carries provider-specific account
        // metadata in `state.val` (sometimes also `data` /
        // `accountData`). We probe a small set of common keys; if
        // none are populated, callers fall back to `null`.
        state?: { val?: Record<string, unknown> };
        data?: Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
      try {
        account = await sdk.connectedAccounts.get(brokerConnectionId);
      } catch (err) {
        throw new IntegrationFetchError(
          "notion",
          err instanceof Error ? err.message : String(err)
        );
      }
      const stateVal = (account.state?.val ?? {}) as Record<string, unknown>;
      const data = (account.data ?? {}) as Record<string, unknown>;
      const probe = (key: string): string | null => {
        for (const bag of [stateVal, data, account]) {
          const v = bag[key];
          if (typeof v === "string" && v.length > 0) return v;
        }
        return null;
      };
      const accountEmail =
        probe("email") ??
        probe("emailAddress") ??
        probe("user_email") ??
        probe("userEmail");
      const accountLabel =
        probe("name") ??
        probe("displayName") ??
        probe("user_name") ??
        probe("login");
      return {
        status: mapBrokerStatus(account.status),
        accountEmail,
        accountLabel,
      };
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

    async listObjects({ brokerConnectionId, entityId, provider, listInput }) {
      const cfg = getProviderConfig(provider);
      // Service layer guards before reaching here — keep narrowing
      // local so this stays a single source of truth on the broker
      // boundary.
      if (!cfg.listActionSlug || !cfg.buildListArgs || !cfg.parseListResponse) {
        throw new IntegrationFetchError(
          provider,
          `${provider} does not expose a read/list action`
        );
      }
      const args = cfg.buildListArgs(listInput);
      const data = await execute(
        provider,
        cfg.listActionSlug,
        brokerConnectionId,
        entityId,
        args
      );
      return cfg.parseListResponse(data);
    },

    async fetchObject({ brokerConnectionId, entityId, provider, fetchInput }) {
      const cfg = getProviderConfig(provider);
      if (!cfg.fetchActionSlug || !cfg.buildFetchArgs || !cfg.parseFetchResponse) {
        throw new IntegrationFetchError(
          provider,
          `${provider} does not expose a read/fetch action`
        );
      }
      const args = cfg.buildFetchArgs(fetchInput);
      const data = await execute(
        provider,
        cfg.fetchActionSlug,
        brokerConnectionId,
        entityId,
        args
      );
      return cfg.parseFetchResponse(data);
    },

    async executeAction({ brokerConnectionId, entityId, provider, slug, arguments: args }) {
      const data = await execute(
        provider,
        slug,
        brokerConnectionId,
        entityId,
        args
      );
      return { raw: data };
    },

    async listToolkitTools(toolkitSlug) {
      let tools: Array<{
        slug?: string;
        description?: string;
        inputParameters?: Record<string, unknown>;
      }>;
      try {
        // Hard cap; Composio's biggest toolkits (Slack, Notion) have
        // ~80–120 actions. 500 is overhead-light and well above any
        // current toolkit size.
        tools = await sdk.tools.getRawComposioTools({
          toolkits: [toolkitSlug],
          limit: 500,
        });
      } catch (err) {
        throw new IntegrationFetchError(
          "notion",
          `Couldn't list ${toolkitSlug} toolkit tools: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return tools
        .filter((t) => typeof t.slug === "string")
        .map((t) => ({
          slug: t.slug as string,
          description: t.description ?? "",
          inputSchema: (t.inputParameters as Record<string, unknown> | undefined) ?? {
            type: "object",
            properties: {},
          },
        }));
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
