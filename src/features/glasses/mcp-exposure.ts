import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient } from "@dopl/client";
import { offeredToolsFor } from "@dopl/mcp-server/factory";
import { consumeMcpCredits } from "@/features/billing/server/credits-service";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { deviceRepository } from "./devices-repository";
import { glassesRepository } from "./repository";
import { registerGlassesTools, type GlassesToolOptions } from "./tools";
import { TtlCache } from "./ttl-cache";

/**
 * How the glasses tools reach the MCP surfaces, and how glasses work is metered.
 *
 * METERING — one credit per call, like every Dopl MCP tool:
 *   - MCP tool calls charge through the SAME seam the registrar uses
 *     (`DoplClient.consumeCredits` → `POST /api/mcp/credits/consume`), so the
 *     route's `withWorkspaceAuth` applies the credential's container lock, rule
 *     B's session channel and the call tally exactly as for `dopl_*` tools. The
 *     addressed container is the credential's lock, else the caller's home.
 *   - Voice / Hey Even utterances have no MCP credential (a device credential),
 *     so they charge in-process through `consumeMcpCredits` on the owner's home
 *     container ({@link utteranceCharger}).
 * Both fail OPEN on a thrown charge — the registrar's rule
 * (`packages/mcp-server/src/registrar.ts › createCharger`).
 */

/** Real stores for the tool handlers. */
export const glassesToolDeps = { store: glassesRepository, devices: deviceRepository };

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

/** Charges one voice / Hey Even utterance to the device owner's home wallet. */
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

// ─── Main /api/mcp exposure ─────────────────────────────────────────────────

const activeCache = new TtlCache<string, boolean>(30_000, 5_000);

/**
 * Does `userId` have at least one paired, unrevoked device? Asked once per
 * `/api/mcp` request, so cached per process for 30s (bounded to 5k users): a
 * new pairing shows its tools within half a minute, a revoke hides them as fast.
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
 * The containment profile's verdict on glasses tools. They are NOT in the
 * `dopl_only` allow list (they reach hardware outside Dopl) and `read_only`
 * offers nothing, so only an absent header, `channel_agent` or `full` gets
 * them — asked of `@dopl/mcp-server`'s own table, never a second copy.
 */
export function profileOffersGlasses(toolProfile: string | null | undefined): boolean {
  return offeredToolsFor(toolProfile) === null;
}

/** Add the glasses tools to a main `/api/mcp` server when the caller owns paired glasses. */
export async function maybeRegisterGlassesTools(
  server: McpServer,
  userId: string,
  opts: Omit<GlassesToolOptions, "charge"> & {
    toolProfile?: string | null;
    client: DoplClient;
    lockedContainerId: string | null;
  },
): Promise<void> {
  if (!profileOffersGlasses(opts.toolProfile)) return;
  if (!(await hasActiveGlasses(userId))) return;
  registerGlassesTools(server, glassesToolDeps, userId, {
    canWrite: opts.canWrite,
    signal: opts.signal,
    charge: mcpToolCharger(opts.client, userId, opts.lockedContainerId),
  });
}
