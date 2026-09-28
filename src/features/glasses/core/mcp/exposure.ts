import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient } from "@dopl/client";
import { offeredToolsFor } from "@dopl/mcp-server/factory";
import { consumeMcpCredits } from "@/features/billing/server/credits-service";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { deviceRepository } from "../devices/repository";
import { glassesRepository } from "../messages/repository";
import { TtlCache } from "../ttl-cache";
import { registerGlassesTools } from "./tools";
import { channelDisplays } from "../screens/channel-displays";
import { sessionChannelId } from "@/shared/auth/session-header";

/**
 * How the glasses tools reach the MCP surfaces, and how glasses work is metered
 * (one credit per call, like every Dopl MCP tool):
 *   - MCP calls charge through the SAME seam the registrar uses
 *     (`DoplClient.consumeCredits` → `/api/mcp/credits/consume`), so the
 *     container lock, rule B's session channel and the call tally apply exactly
 *     as for `dopl_*` tools.
 *   - Voice / assistant utterances carry a device credential, not an MCP one, so
 *     they charge in-process on the owner's home container ({@link utteranceCharger}).
 * Both fail OPEN on a thrown charge, the registrar's rule
 * (`packages/mcp-server/src/registrar.ts › createCharger`).
 */

const glassesToolDeps = { store: glassesRepository, devices: deviceRepository };

const EXHAUSTED = "Your Dopl credits are used up for this period.";
const refusalText = (upgradeUrl: string | undefined) => (upgradeUrl ? `${EXHAUSTED} Upgrade: ${upgradeUrl}` : EXHAUSTED);

/** Charges glasses MCP calls through the caller's own loopback client. */
export function mcpToolCharger(client: DoplClient, userId: string, lockedContainerId: string | null) {
  let workspaceId: Promise<string> | null = null;
  return async (write: boolean): Promise<string | null> => {
    try {
      workspaceId ??= resolveActiveWorkspace(userId, lockedContainerId).then((r) => r.workspace.id);
      const outcome = await client.consumeCredits(await workspaceId, { tool: "glasses", op: "", write });
      return outcome?.allowed === false ? refusalText(outcome.upgradeUrl) : null;
    } catch (err) {
      workspaceId = null;
      console.error("[glasses] credit charge failed; running unmetered", err);
      return null;
    }
  };
}

/** Charges one voice / assistant utterance to the device owner's home wallet. */
export async function utteranceCharger(userId: string): Promise<string | null> {
  try {
    const { workspace } = await resolveActiveWorkspace(userId, null);
    const r = await consumeMcpCredits(workspace.id, { userId, workspaceKind: workspace.kind, channelId: null });
    return r.allowed ? null : refusalText(r.upgradeUrl);
  } catch (err) {
    console.error("[glasses] utterance charge failed; running unmetered", err);
    return null;
  }
}

const activeCache = new TtlCache<string, boolean>(30_000, 5_000);

/**
 * Does `userId` have at least one paired, unrevoked device? Asked on every
 * `/api/mcp` request, so cached per process for 30s: a new pairing shows its
 * tools within half a minute, and a revoke hides them as fast.
 */
export async function hasActiveGlasses(userId: string, now = Date.now()): Promise<boolean> {
  const hit = activeCache.get(userId, now);
  if (hit !== undefined) return hit;
  let has = false;
  try {
    has = (await deviceRepository.countActiveDevices(userId)) > 0;
  } catch (err) {
    // Hiding the tools is the safe failure: the main surface must never break on this read.
    console.error("[glasses] device count failed; glasses tools hidden", err);
  }
  activeCache.set(userId, has, now);
  return has;
}

/**
 * The containment profile's verdict. Glasses tools are NOT in the `dopl_only`
 * allow list (they reach hardware outside Dopl) and `read_only` offers nothing,
 * so only an absent header, `channel_agent` or `full` gets them, asked of
 * `@dopl/mcp-server`'s own table rather than a second copy. The tool-set claim
 * (`readToolSetClaim`) is not an input: on `/api/mcp` it only renames `dopl_*`
 * tools and never narrows, and glasses tools carry one name in both sets.
 */
export function profileOffersGlasses(toolProfile: string | null | undefined): boolean {
  return offeredToolsFor(toolProfile) === null;
}

export interface GlassesCaller {
  userId: string;
  scopes: readonly string[] | undefined;
  toolProfile: string | null | undefined;
  client: DoplClient;
  /** The credential's container lock, charged instead of the caller's home. */
  lockedContainerId: string | null;
  /** `X-Dopl-Session-Id` (`<channelId>:…` for a Dopl channel session): screens are mirrored there. */
  sessionId?: string | null;
  signal?: AbortSignal;
}

/**
 * Put the glasses tools on `server` when the caller's containment profile
 * offers them. `requireDevice` (the main `/api/mcp`) also asks that the caller
 * own paired glasses, so users without glasses see no extra tools.
 */
export async function exposeGlassesTools(
  server: McpServer,
  caller: GlassesCaller,
  { requireDevice }: { requireDevice: boolean },
): Promise<void> {
  if (!profileOffersGlasses(caller.toolProfile)) return;
  if (requireDevice && !(await hasActiveGlasses(caller.userId))) return;
  const displays = channelDisplays(caller.client, sessionChannelId(caller.sessionId));
  registerGlassesTools(server, { ...glassesToolDeps, displays }, caller.userId, {
    canWrite: caller.scopes?.includes("dopl.write") ?? false,
    signal: caller.signal,
    charge: mcpToolCharger(caller.client, caller.userId, caller.lockedContainerId),
  });
}
