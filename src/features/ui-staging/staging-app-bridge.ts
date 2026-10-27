"use client";

/**
 * The frame's base layer of the playground bridge (`./staging-bridge.ts`): what main and the API
 * answer for the shell, the popups and Settings on every staged page. The PRODUCT components
 * read it through `getSpaBridge()` exactly as they read main in the desktop app.
 */

import { toast } from "@/shared/ui/toast";
import { homeApiRequest } from "@/features/popups-staging/home-server";
import { stagingNotifications } from "@/features/popups-staging/toast-ops";
import { settingsApiRequest } from "@/features/settings-staging/settings-server";
import { stagingChannelsOps, stagingRuntimeAuth } from "@/features/settings-staging/desktop-ops";
import { stagingSearchFetcher } from "./data/search-results";
import { STAGING_USER_ID } from "./staging-stubs";
import {
  bridgeOk,
  useStagingBridgeLayer,
  type BridgeOpts,
  type BridgeResponse,
  type StagingBridgeLayer,
} from "./staging-bridge";

/** `GET /api/search`, answered by the staged story's fixture fetcher. */
async function searchApiRequest(path: string, opts: BridgeOpts): Promise<BridgeResponse | null> {
  const url = new URL(path, "http://staging.invalid");
  if ((opts.method ?? "GET").toUpperCase() !== "GET" || url.pathname !== "/api/search") return null;
  const q = url.searchParams.get("q") ?? "";
  const scope = url.searchParams.get("scope") === "container" ? "container" : "account";
  const container = url.searchParams.get("container") ?? undefined;
  const signal = new AbortController().signal;
  return bridgeOk(await stagingSearchFetcher({ q, scope, containerId: container, signal }));
}

const SERVERS = [settingsApiRequest, homeApiRequest, searchApiRequest];

const APP_LAYER: StagingBridgeLayer = {
  async apiRequest(path, opts) {
    for (const serve of SERVERS) {
      const answer = await serve(path, opts);
      if (answer) return answer;
    }
    return null;
  },
  getAuthState: async () => ({ signedIn: true, userId: STAGING_USER_ID }),
  openExternal: async (url: string) => {
    toast({ title: `Staging: would open ${url}` });
    return { ok: true };
  },
  signOut: async () => {
    toast({ title: "Staging: would sign out" });
    return { ok: true };
  },
  runtimeAuth: stagingRuntimeAuth,
  notifications: stagingNotifications,
  channels: stagingChannelsOps,
};

/** Registers the frame's layer; `true` once the product shell can read it. */
export function useStagingAppBridge(): boolean {
  return useStagingBridgeLayer(APP_LAYER, { base: true });
}
