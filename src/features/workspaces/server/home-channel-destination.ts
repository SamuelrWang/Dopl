import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { findWorkspaceById } from "./repository";

/**
 * 🔒 **A HOME CHANNEL HOLDS ONLY WHAT IS SHARED INTO IT — SAMUEL'S RULING,
 * 2026-09-18.** Verbatim, because this module exists for it: *"that destination
 * should just not exist. It doesn't make any sense to have a destination like
 * that… You have one container, right? One container is the entire home space.
 * That is a container… You can have smaller containers inside this container,
 * and that's a container for each channel. Those are basically the two
 * containers."*
 *
 * ── THE TWO DESTINATIONS, AND THE THIRD THAT IS NOW REFUSED ────────────────
 *
 *   1. **HOME** — the caller's own `kind='personal'` container. One member, so
 *      a `private` row there is visible on every home channel's Personal
 *      section (`shared/tenancy/personal-container.ts` routes it).
 *   2. **A HOME CHANNEL** — the channel's `kind='link'` container, with the row
 *      SHARED into the channel. That is what the /home Shared section's create
 *      button makes: for a template, `visibility: 'workspace'`
 *      (`agent-templates/lib/visibility.ts › SECTIONS_CONTAINER`, which offers
 *      nothing else); for a knowledge base, `shareToChannelId`
 *      (`knowledge/components/create-base-dialog.tsx`, which drops the
 *      audience picker because the grant IS the answer).
 *   3. 🚫 **A PRIVATE, UNGRANTED ROW INSIDE A `kind='link'` CONTAINER** — the
 *      destination this fence deletes. **It is reachable from nowhere**:
 *      `SECTIONS_CONTAINER` stopped listing it on 2026-08-27, /home's Knowledge
 *      face lists only bases carrying a channel grant, and a container is not
 *      navigable at all (`isStandardWorkspace` keeps it off the rail), so it has
 *      no page of its own. A row written there is a WRITE-ONLY row.
 *
 * ⚠ **THE FENCE IS THE SERVER'S, NOT A SURFACE'S, AND THAT IS THE WHOLE POINT
 * OF THE FILE.** The 2026-08-27 ruling was applied by trimming ONE array in the
 * desktop editor; every other door — `POST /api/agent-templates`,
 * `POST /api/knowledge/bases`, and `dopl_agent` / `dopl_kb` behind them — kept
 * writing the row without a word. That is the prompt-only shape:
 * a rule enforced where the caller happens to enter. Six agent templates and
 * eight knowledge bases were measured in this state on 2026-09-18.
 *
 * ⚠ **`kind === "link"` POSITIVELY, NEVER `!isStandardWorkspace`** (F-564). This
 * states a PROPERTY OF ONE KIND: a `kind='personal'` container is exactly where
 * destination 1's private rows belong, and a negative spelling would refuse
 * them. `authz.ts › assertWorkspacePermanent` asks positively for the same
 * reason.
 *
 * ⚠ **WORKSPACES (`kind='standard'`) ARE UNTOUCHED.** A private template or base
 * in a workspace is listed by that workspace's own Agents / Knowledge page, so
 * there is no orphan and nothing to refuse. Pinned by
 * `home-channel-destination.test.ts`.
 *
 * ⚠ **A MISSING WORKSPACE ROW PASSES**, for the reason
 * `shared-publish.ts › assertSharedPublishAcknowledged` states about its own:
 * `withWorkspaceAuth` proved an active membership before this ran, so `null`
 * means the row vanished mid-request and the write underneath is about to fail
 * on its own. This gate must not be the thing that reports that.
 *
 * ⚠ **IT DOES NOT MIGRATE THE ROWS THAT ARE ALREADY THERE.** Cleanup is a
 * separate, Samuel-approved step (F-731); every read path keeps listing them.
 */

/**
 * 🔒 400, NOT 403 — G16's argument (`shared-publish.ts ›
 * ContainerPublishUnacknowledgedError`), one axis over: the caller is allowed to
 * create here, the REQUEST names a destination that does not exist. A 403 would
 * read as "you may not author in this channel", which is false and is the
 * opposite of what the remedy asks for.
 *
 * ⚠ It extends `HttpError`, so `shared/api/http-error-response.ts`'s
 * pass-through carries it at EVERY boundary with no per-feature mapping arm —
 * the same reason `PersonalContainerMissingError` is shaped this way, and the
 * reason two feature mappers did not have to grow a hand-mirrored arm each.
 */
export class HomeChannelRowNotSharedError extends HttpError {
  constructor(message: string) {
    super(400, "HOME_CHANNEL_ROW_NOT_SHARED", message);
    this.name = "HomeChannelRowNotSharedError";
  }
}

/** What the refusal has to say to be actionable: the thing, and the two
 *  destinations that DO exist, in the caller's own vocabulary. */
export interface HomeChannelDestination {
  /** The container the row LANDS in — never the one the call stands in. A
   *  personal row has already been re-routed by the time this is asked. */
  workspaceId: string;
  /** Is the row shared into the channel? Each feature answers in its own terms
   *  — the audience column for a template, a channel grant for a base — and the
   *  rule above them is one sentence. */
  shared: boolean;
  /** "agent template" / "knowledge base". */
  noun: string;
  /** How this caller shares it, named exactly. ⚠ One clause, no explainer. */
  remedy: string;
}

/**
 * Refuse a row that would land private and ungranted inside a home channel.
 *
 * ⚠ **ONE READ, AND ONLY ON THE PRIVATE LANE.** A shared row asks nothing, so
 * every create-and-share and every workspace write pays nothing.
 */
export async function assertHomeChannelRowIsShared({
  workspaceId,
  shared,
  noun,
  remedy,
}: HomeChannelDestination): Promise<void> {
  if (shared) return;
  const workspace = await findWorkspaceById(workspaceId);
  if (workspace?.kind !== "link") return;
  throw new HomeChannelRowNotSharedError(
    `A home channel holds only what is shared into it, so this ${noun} was not created. ` +
      `Either share it into the channel (${remedy}), or keep it to yourself in your home space.`
  );
}
