/**
 * `dopl_kb` base writes (create, update, publish); the tree inside a base is `knowledge-ops-write.ts`.
 * Errors map to actionable messages — 403 agent-write-denied, 400 validation/unshared/unacknowledged here, 412/409 in
 * the tree writes — and anything unmapped rethrows. Confirmations read back the STORED value and neutralize it.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr, NO_NAME } from "./narration";
import { ok, err, apiMessage, isApiError, type ToolResponse } from "./respond";
import {
  resolveBaseOr,
  writeOr,
} from "./knowledge-shared";
import { updateBaseValidationError } from "./knowledge-validation";
import { isErr } from "./channel-shared";
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token";
import type { WorkspaceDirectory } from "../workspace-directory";
import {
  homeChannelRowNotShared,
  resolveChannelShareTarget,
} from "./container-destination";

/** Maps 403 `AGENT_WRITE_DISABLED` off `create_base` to the server's own sentence (duck-typed on the code). */
function agentCreateForbidden(e: unknown): string | null {
  if (!isApiError(e, 403, "AGENT_WRITE_DISABLED")) return null;
  const detail = apiMessage(e) ?? "An agent cannot create a knowledge base here.";
  return `${detail} Nothing was created — no row, no slug taken, so retrying the same call will fail the same way.`;
}

/** The confirm gate (a tripwire, `confirm-token.ts`) fires only for `public` inside a shared container — any
 *  container with a second member, whatever its kind. */
export async function opCreateBase(
  client: DoplClient,
  callerUserId: string | null,
  input: {
    name: string;
    description?: string;
    visibility?: "public" | "private";
    confirm_token?: string;
    /** Idempotency key, passed through: the server returns the first base rather than minting a second. */
    client_write_id?: string;
  },
  /** Optional: absent = not known, so the create goes out unshared and the server refuses it in a home channel. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  // A home channel holds only what is shared into it: the base stays `private` and the channel grant is the audience.
  const shareToChannelId = await resolveChannelShareTarget(client, directory);
  // Always sent: the server's default is credential-dependent, which this process cannot see (as `agent-ops-write.ts › opCreate`).
  const visibility = input.visibility ?? "private";

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_kb",
      op: "create_base",
      callerUserId,
      what: `a knowledge base named ${inlineOr(input.name, NO_NAME)}, readable by the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it and read everything you put in it`,
      payload: {
        name: input.name,
        description: input.description ?? null,
        visibility,
        // On the digest: a token binds what lands, grant included.
        shareToChannelId: shareToChannelId ?? null,
      },
    },
    {
      publishes: visibility === "public",
      token: input.confirm_token,
      // The preview asks the server's own create gate chain (`?dryRun=1`) with the body the confirm will send,
      // `acknowledgeShared` included, so no token is minted for an act the gate forbids.
      precheck: async () => {
        try {
          await client.dryRunKbBase({
            name: input.name,
            description: input.description,
            visibility,
            shareToChannelId,
            acknowledgeShared: true,
          });
        } catch (e) {
          const ceiling = agentCreateForbidden(e);
          if (ceiling) return err(ceiling);
          // Anything else rethrows rather than minting: "could not check" is not "allowed".
          throw e;
        }
        return null;
      },
    },
  );
  if (verdict.kind === "halt") return verdict.response;

  let base;
  try {
    base = await client.createKbBase({
      name: input.name,
      clientWriteId: input.client_write_id,
      description: input.description,
      visibility,
      // Atomic: the base rolls back if the grant fails.
      shareToChannelId,
      // Only ever `true`, and only from a token this call actually spent.
      acknowledgeShared: verdict.acknowledgedShared || undefined,
    });
  } catch (e) {
    // The audience ceiling's create refusal, rendered as a refusal rather than a transport error (F-323).
    const ceiling = agentCreateForbidden(e);
    if (ceiling) return err(ceiling);
    // The destination probe fails open, so this is the server refusing an unshared home-channel create.
    const unshared = homeChannelRowNotShared(e);
    if (unshared) return unshared;
    // Only a race here: the room gained a member between the preview and the act.
    const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
    if (unacknowledged) return unacknowledged;
    throw e;
  }
  // The grant is the audience: a shared base is stored `private`.
  const visNote = shareToChannelId
    ? "Shared in this channel — everyone here can read it."
    : base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  // The id beside the slug: it survives renames and ambiguous slugs.
  return ok(
    `Created knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`, id: \`${base.id}\`). ${visNote}`
  );
}

export async function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const updated = await writeOr(
    () => client.updateKbBase(base.id, { name, description, slug }),
    updateBaseValidationError,
  );
  if (isErr(updated)) return updated;
  // The id too: an update can change the slug.
  return ok(
    `Updated ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`, id: \`${updated.id}\`).`
  );
}

/** Publishes a base, previewing and confirming as `create_base` does (F-441). The 400 mapping is not dead code: the
 *  server's predicate (`shared-publish.ts`) is the authority and can refuse on facts this process cannot see. */
export async function opSetVisibility(
  client: DoplClient,
  callerUserId: string | null,
  ref: string,
  visibility: string,
  confirmToken?: string,
): Promise<ToolResponse> {
  if (visibility !== "public") {
    return err(
      `set_visibility only publishes (visibility="public") a base you created. Un-publishing is human-only — use the Dopl web UI.`,
    );
  }
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;

  // Gated after the base resolves, so the preview names the base this call is about.
  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_kb",
      op: "set_visibility",
      callerUserId,
      what: `the knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`), published workspace-wide`,
      audience: `everyone in that home channel — the peer standing in it can read everything in it, including what was written while it was private`,
      payload: { base: base.id, visibility: "public" },
    },
    { publishes: true, token: confirmToken },
  );
  if (verdict.kind === "halt") return verdict.response;

  // A 400 here comes after the gate passed, so the remedy is the operator, not a re-preview.
  const updated = await writeOr(
    () =>
      client.updateKbBase(base.id, {
        visibility: "public",
        acknowledgeShared: verdict.acknowledgedShared || undefined,
      }),
    (e) =>
      containerPublishUnacknowledged(
        e,
        `This call already previewed and confirmed, so the server is refusing on a fact this process cannot see — re-previewing would answer the same. Ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`,
      ),
  );
  if (isErr(updated)) return updated;
  return ok(
    `Published knowledge base ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`,
  );
}
