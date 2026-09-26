import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { consumeMcpCredits } from "@/features/billing/server/credits-service";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { sessionChannelId } from "@/shared/auth/session-header";
import { deviceRepository } from "./devices-repository";
import { glassesRepository } from "./repository";
import { registerGlassesTools, type GlassesToolOptions } from "./tools";

/**
 * How the glasses tools reach the two MCP surfaces, and how they are metered.
 *
 * METERING follows every other Dopl MCP tool: one credit per call
 * (`CREDITS_PER_MCP_CALL`), charged before the handler through
 * `consumeMcpCredits`, addressed to the caller's HOME container (glasses tools
 * act on the person, not on any container) with rule B's channel hint from
 * the session header, so a desktop session's call lands on its channel's
 * wallet exactly as a `dopl_*` call would. Fail OPEN on a thrown charge — the
 * registrar's rule (`packages/mcp-server/src/registrar.ts › createCharger`).
 */

/** Real stores for the tool handlers. */
export const glassesToolDeps = { store: glassesRepository, devices: deviceRepository };

export function glassesCreditCharger(userId: string, sessionId: string | null | undefined) {
  return async (): Promise<string | null> => {
    try {
      const { workspace } = await resolveActiveWorkspace(userId, null);
      const r = await consumeMcpCredits(workspace.id, {
        userId,
        workspaceKind: workspace.kind,
        channelId: sessionChannelId(sessionId),
      });
      if (r.allowed) return null;
      const head = "Your Dopl credits are used up for this period.";
      return r.upgradeUrl ? `${head} Upgrade: ${r.upgradeUrl}` : head;
    } catch (err) {
      console.error("[glasses] credit charge failed; running unmetered", err);
      return null;
    }
  };
}

// ─── Main /api/mcp exposure ─────────────────────────────────────────────────

const CACHE_MS = 30_000;
const activeCache = new Map<string, { has: boolean; at: number }>();

/**
 * Does `userId` have at least one paired, unrevoked device? Asked once per
 * `/api/mcp` request, so it is cached per process for 30s: a new pairing shows
 * its tools within half a minute, a revoke hides them as fast.
 */
export async function hasActiveGlasses(userId: string, now = Date.now()): Promise<boolean> {
  const hit = activeCache.get(userId);
  if (hit && now - hit.at < CACHE_MS) return hit.has;
  let has = false;
  try {
    has = (await deviceRepository.countActiveDevices(userId)) > 0;
  } catch (err) {
    // Hiding the tools is the safe failure: the main surface must never break on this read.
    console.error("[glasses] device count failed; glasses tools hidden", err);
  }
  activeCache.set(userId, { has, at: now });
  return has;
}

/** Add the glasses tools to a main `/api/mcp` server when the caller owns paired glasses. */
export async function maybeRegisterGlassesTools(
  server: McpServer,
  userId: string,
  opts: Omit<GlassesToolOptions, "charge"> & { sessionId?: string | null },
): Promise<void> {
  if (!(await hasActiveGlasses(userId))) return;
  registerGlassesTools(server, glassesToolDeps, userId, {
    canWrite: opts.canWrite,
    signal: opts.signal,
    charge: glassesCreditCharger(userId, opts.sessionId),
  });
}
