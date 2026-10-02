import "server-only";
import { describeCredential } from "@/shared/auth/mcp-credential";
import { redirectHost } from "@/features/devices/server/agent-apps";
import { readGrantOrigin, type GrantOrigin } from "@/features/devices/server/agent-apps-repository";
import { isExternalSessionAuthor } from "../lib/desktop-handle";
import { buildViaStamp, type ViaStamp } from "../lib/message-via";
import type { ChannelContext } from "./service-shared";

/**
 * **WHEN A POST GETS `metadata.via`, AND THE ONE READ IT COSTS** — the server half of
 * `lib/message-via.ts` (which decides WHAT the stamp says and whether it is verified).
 *
 * ONLY an OUTSIDE SESSION's post, i.e. ALL of:
 *   - `isExternalSessionAuthor` — an `agent` author with no `desktop-session` runtime stamp;
 *   - an agent CREDENTIAL (`ctx.agentTokenId`): the facts come off the token row, so a cookie
 *     session (a person, or the desktop's own cookie-lane agent posts) never carries one;
 *   - 🔒 no container lock (`ctx.apiKeyWorkspaceId`): only the desktop's container minter sets
 *     `mcp_tokens.container_id`, so this is the UNFORGEABLE mark of a desktop-spawned session —
 *     the one `desktop-handle.ts`'s F-741 note says the runtime header alone cannot give.
 *
 * ⚠ **NEVER THROWS.** A failed read is a post without a "via", never a refused post.
 */
export async function resolveViaStamp(
  ctx: Pick<ChannelContext, "agentTokenId" | "apiKeyWorkspaceId" | "runtime" | "clientInfo">,
  authorKind: "user" | "agent",
  read: (tokenId: string) => Promise<GrantOrigin | null> = readGrantOrigin
): Promise<ViaStamp | null> {
  if (!ctx.agentTokenId || ctx.apiKeyWorkspaceId) return null;
  if (!isExternalSessionAuthor(authorKind, ctx.runtime ?? null)) return null;
  let origin: GrantOrigin | null = null;
  try {
    origin = await read(ctx.agentTokenId);
  } catch (err) {
    console.error("[channels] via lookup failed", err);
  }
  const credential = describeCredential(origin?.client_id, origin?.client_name);
  return buildViaStamp({
    // No row read ⇒ treat as a device token: only the self-declared client info can speak.
    credentialKind: origin ? credential.kind : "device",
    clientName: credential.label,
    redirectUris: origin?.redirect_uris ?? null,
    redirectHost: redirectHost(origin?.redirect_uris ?? null),
    clientInfo: ctx.clientInfo ?? null,
  });
}
