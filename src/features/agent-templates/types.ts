/**
 * Agent-template domain types. A template is a PERSISTENT agent identity —
 * name, instructions, a default model, user-defined fields and referenced
 * knowledge bases — that outlives any session spawned from it. camelCase here;
 * snake_case row shapes in `server/dto.ts`.
 *
 * ⚠ VISIBILITY IS ONE FIELD HERE AND TWO IN SKILLS/CHATS/KBs. Those features
 * store `visibility` ('public'|'private') × `accessMode` ('workspace'|'teams')
 * because `accessMode` was added to a live table and its default was the
 * backfill; `src/features/skills/scope.ts › skillScope` is the helper that
 * collapses the pair back into exactly the three values below. This table is
 * new and stores the collapsed form directly. When porting a predicate across,
 * `visibility === "team"` here == `visibility "public" + accessMode "teams"`
 * there.
 */

/** ⚠ {@link TemplateVisibility} is DECLARED in `@dopl/contracts › workspaces.ts`
 *  and re-exported here (2026-09-02) — it had an unguarded twin in
 *  `packages/dopl-client/src/agent-template-types.ts`. No import path changed. */
import type { TemplateVisibility } from "@dopl/contracts";

export type { TemplateVisibility };

import type { Role } from "@/features/workspaces/types";

export const TEMPLATE_VISIBILITIES: readonly TemplateVisibility[] = [
  "private",
  "team",
  "workspace",
] as const;

/**
 * One user-defined custom field. Free-form by design — the product does not
 * know what an operator wants to carry into a session (a persona's tone, a
 * repo path, a customer id), so it does not model it. Both halves are short
 * labels: they are spliced into the launch payload an agent reads.
 */
export interface TemplateField {
  key: string;
  value: string;
}

/**
 * A knowledge base attached to a template — a REFERENCE, never a copy. Only
 * `{id, name}` is carried; the agent reads the base itself through the
 * knowledge tools, so a base that later goes private or is deleted degrades to
 * "gone" rather than to a stale snapshot living in a template.
 */
export interface TemplateKnowledgeBaseRef {
  id: string;
  name: string;
}

/**
 * HOW MUCH OF A BASE AN ATTACHMENT NAMES (2026-09-08, Samuel: *"right now, you
 * can only select entire bases, but I want to be able to specific folders or
 * entries/files"*).
 *
 * ⚠ **A FOLDER MEANS ITS SUBTREE, INCLUDING WHAT IS ADDED LATER** — the folder
 * id is stored, never expanded into a row per child, because an expansion is a
 * snapshot and an entry filed tomorrow would silently not be attached.
 * ⚠ **AN ATTACHMENT, NOT A PERMISSION.** The read ceiling
 * (`knowledge/server/service-audience.ts › resolveAgentAudience`) stays
 * base-keyed: a folder scope narrows what the role block POINTS AT. Filed as a
 * finding; never read this union as access control.
 */
export type TemplateKnowledgeScopeKind = "base" | "folder" | "entry";

/**
 * The WRITE shape — ids only, because ids are the stable handle. `knowledge_folders`
 * and `knowledge_entries` carry NO path column (a path is derived by walking
 * `parent_id`, `knowledge/server/path.ts › resolvePath`), so a path on the wire
 * would be a name a rename silently falsifies.
 */
export type TemplateKnowledgeScope =
  | { baseId: string; scope: "base" }
  | { baseId: string; scope: "folder"; folderId: string }
  | { baseId: string; scope: "entry"; entryId: string };

/**
 * ONE TOP-LEVEL FOLDER OF AN ATTACHED BASE, as the base CARD names it
 * (2026-09-18, A4). A name and, when the folder has one, the clause its own
 * editor wrote.
 *
 * ⚠ **NO IDS AND NO ENTRIES.** The card exists so an agent can pick a
 * `list_dir` target without a `get_tree` round trip; a folder is addressed by
 * its NAME inside a knowledge path, so an id would be a fact with no call to
 * put it in. Entries are never carried at any depth — that is what makes the
 * card FIXED-SIZE rather than a function of how big the base got.
 */
export interface TemplateKnowledgeFolderBrief {
  name: string;
  /**
   * `knowledge_folders.description`, the agent-facing summary (≤`DESCRIPTION_MAX`).
   * ⚠ **ABSENT, NEVER CLIPPED.** A clause longer than a card can carry is
   * omitted whole: half a sentence read as the whole one is a lie the reader
   * cannot detect.
   */
  summary?: string;
}

/**
 * The READ shape — one attached scope, resolved against what the READING caller
 * may see. Names are for DISPLAY; the ids are what anything acts on.
 *
 * ⚠ `path` IS DERIVED SERVER-SIDE, DISPLAY ONLY (`Base / Folder / Entry`) and
 * recomputed per read, so a rename shows up rather than rotting. It is user
 * text: the desktop sanitizes it at render.
 */
export interface TemplateKnowledgeRef {
  baseId: string;
  baseName: string;
  scope: TemplateKnowledgeScopeKind;
  folderId?: string;
  folderName?: string;
  entryId?: string;
  entryTitle?: string;
  path: string;
  /**
   * The same address as a BASE-RELATIVE knowledge path — `Deploys/Rollback.md`
   * — `/`-joined the way `knowledge/server/path.ts › parsePath` reads one.
   * Absent on a `base` scope, which addresses the base root and needs no path.
   *
   * ⚠ **A SECOND FIELD RATHER THAN STRING SURGERY ON `path`** — `path` leads
   * with the base name and joins on `" / "`, so recovering this from it means
   * splitting on a separator a base name may itself contain ("Ops / Legal"), and
   * a wrong path here is an agent silently pointed at the wrong document.
   */
  toolPath?: string;
  /**
   * ── THE BASE CARD (2026-09-18, A4) — `baseSlug` … `baseFolderCount` ───────
   *
   * Four facts that let a role block NAME an attached base well enough to open
   * the right thing without a `get_tree`-and-guess round trip. All four are
   * **`scope: "base"` ONLY**: a folder or entry scope already names the exact
   * thing it points at, so a card on one would be noise over an answer.
   *
   * 🔒 ⚠ **THE CARD IS FIXED-SIZE BY CONSTRUCTION, NOT BY TRUNCATION.** Nothing
   * here grows with the base — no entry list, no recursive folder tree, no
   * counts of content — so a base with forty entries and a base with four
   * produce the same card. The desktop caps the RENDERED card at 400 characters
   * per base and degrades by DROPPING WHOLE FACTS
   * (`prompt-framing-template.js › baseCard`); this payload never hands it a
   * fact it would have to cut in half.
   *
   * The base's kebab-case slug. ⚠ **AN ADDRESS, NOT A LABEL** — `dopl_kb`'s
   * `base` argument accepts it in place of the id — so the desktop emits it
   * only when it survives `idToken` unchanged.
   */
  baseSlug?: string;
  /**
   * One line on what the base answers — `knowledge_bases.description`.
   * ⚠ **CARRIED WHOLE OR NOT AT ALL**: a description longer than
   * `DESCRIPTION_MAX` is omitted rather than sliced, for the reason
   * {@link TemplateKnowledgeFolderBrief.summary} gives.
   */
  baseSummary?: string;
  /**
   * The base's TOP-LEVEL folders, in read order, each with its own clause.
   * ⚠ **TOP LEVEL ONLY** — the whole subtree is what `get_tree` is for, and a
   * recursive list is exactly the unbounded thing this card refuses to be.
   */
  baseFolders?: TemplateKnowledgeFolderBrief[];
  /**
   * How many top-level folders the base REALLY has.
   *
   * 🔒 ⚠ **THE COMPLETENESS SIGNAL, AND IT IS THE POINT OF THE FIELD.**
   * {@link TemplateKnowledgeRef.baseFolders} is capped — server-side and again
   * at the desktop boundary — and a capped list rendered as if it were the
   * whole list is a lie about a base's shape. The renderer prints the folder
   * line ONLY when `baseFolders.length === baseFolderCount`, so any cap, any
   * dropped malformed row, and any newer server that carries fewer, all fail
   * the same way: the fact disappears instead of becoming wrong.
   */
  baseFolderCount?: number;
}

/**
 * WHICH SHELF a template lives on — /home's "Personal" section or the workspace
 * Agents page. Two PLACES over one table (Samuel, 2026-08-27); since 2026-09-02
 * also two CONTAINERS, the personal shelf being the caller's own
 * `kind='personal'` workspace. `features/knowledge/types.ts › KbShelf` carries
 * the argument, and this MIRRORS it rather than importing it (§1 forbids the
 * cross-feature import, as with `canSeeBase`).
 *
 * ⚠ NOT A FIELD ON `AgentTemplate`, and never make it one — it is a WRITE input
 * (`AgentTemplateCreateInput.homeScoped`, which ROUTES the row) and a READ
 * FILTER (`?shelf=`). Nothing shelf-shaped is projected, so §8's stale-cache
 * rule has nothing to apply to.
 * 🔒 IT IS NOT THE VISIBILITY AXIS. `visibility` says who may READ; this says
 * which surface LISTS. `canSeeTemplate` never sees it.
 * ⚠ ABSENT = NO FILTER, not a third value — which is what keeps the launch
 * picker and `resolveTemplateForLaunch` seeing the whole workspace.
 */
export type TemplateShelf = "home" | "workspace";

export interface AgentTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  /** The system-prompt-shaped block. Prose: multi-line is legitimate. */
  instructions: string | null;
  /** Default model identifier, passed through at spawn. Null = the desktop's
   *  own default; this layer holds no model roster. */
  model: string | null;
  fields: TemplateField[];
  visibility: TemplateVisibility;
  /**
   * Teams this template is shared with. ⚠ Populated only when `visibility` is
   * `'team'`, and only for the creator / workspace admins — team composition is
   * a leak otherwise, exactly as `Skill.grantedTeamIds` is gated.
   */
  teamIds: string[];
  /** Attached KBs, VIEWER-FILTERED — two callers can get different lists for
   *  one row. ⚠ **BASE-LEVEL SCOPES ONLY SINCE 2026-09-08**, kept for readers
   *  predating {@link AgentTemplate.knowledge}; a folder/entry scope is absent
   *  rather than widened into its base, which would over-report the
   *  attachment. */
  knowledgeBases: TemplateKnowledgeBaseRef[];
  /**
   * EVERY attached scope — base, folder and entry alike (2026-09-08).
   *
   * ⚠ **THE SUPERSET, AND `knowledgeBases` IS ITS BASE-LEVEL SLICE.** One list
   * with a `scope` discriminator, because the attachments are ONE ordered set
   * the operator built.
   * ⚠ VIEWER-FILTERED A LEVEL DEEPER: a scope drops with its base, and also when
   * its folder or entry is gone or trashed. Base drops are counted in
   * {@link AgentTemplate.unreachableKnowledgeBaseCount}.
   *
   * 🔒 **OPTIONAL — §8's STANDING RULE, NOT A HEDGE.** This payload is
   * IndexedDB-persisted (24h `gcTime`), so the first paint after this release
   * renders rows minted by the previous bundle, which carry no such key. Every
   * reader spells `?? EMPTY_KNOWLEDGE` INLINE (`lib/knowledge-scopes.ts`), and
   * this wave's tests include the fixture WITHOUT it.
   */
  knowledge?: TemplateKnowledgeRef[];
  /**
   * HOW MANY ATTACHMENTS THE VIEWER FILTER DROPPED — a COUNT and nothing else
   * (Samuel's ruling, 2026-09-05).
   *
   * 🔒 **A NUMBER IS THE WHOLE DISCLOSURE.** The dropped bases' ids, names,
   * workspace and container are what the viewer filter exists to withhold; the
   * caller learns only that THIS ROLE NAMES SOMETHING IT CANNOT REACH.
   * ⚠ **NOT PROBED FOR** — arithmetic over junction rows the decoration already
   * read, minus the ones the filter kept. No second query.
   * ⚠ **OPTIONAL BECAUSE THE DECORATION IS**: an undecorated row has no answer
   * and `0` would be a claim, so consumers read `?? 0`.
   */
  unreachableKnowledgeBaseCount?: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The flattened payload the desktop fetches at spawn time and the future launch
 * integration consumes VERBATIM. Deliberately NOT `AgentTemplate`: it carries
 * no ids, no visibility and no timestamps, because none of them is an input to
 * starting an agent, and a launch payload that grows fields is a payload
 * whose consumer has to guess which ones matter.
 */
export interface ResolvedAgentTemplate {
  name: string;
  instructions: string | null;
  model: string | null;
  fields: TemplateField[];
  knowledgeBases: TemplateKnowledgeBaseRef[];
  /**
   * THE EIGHTH KEY (2026-09-08): every attached scope, base / folder / entry.
   *
   * ⚠ **IT DOES NOT REPLACE `knowledgeBases` HERE AND MUST NOT.** An older
   * desktop narrows this response through an ALLOWLIST
   * (`main/template-resolve.js › narrow`), so dropping the base list would hand
   * every such build a template with no knowledge at all — §13's older-peer
   * rule, on the one payload where the failure is silent prompt text.
   */
  knowledge: TemplateKnowledgeRef[];
  /**
   * THE SEVENTH KEY (2026-09-05): how many attached bases this launch CANNOT
   * reach. Always a number here — the launch payload has one producer, so
   * "not decorated" cannot arrive and `0` is a real answer.
   *
   * ⚠ **IT EXISTS SO THE AGENT CAN SAY SO.** A base attached in one container
   * and launched in another just vanished from `knowledgeBases`, and an agent
   * cannot report a gap it was never told about. With this, the desktop's ROLE
   * block tells it to say *"I don't have access to this knowledge base in this
   * channel"*.
   * ⚠ **A COUNT, NEVER A LOCATION** (see {@link AgentTemplate}) — this is the
   * one payload where a leak would land in prompt text.
   * ⚠ **IT NEVER BLOCKS A LAUNCH.** The agent starts, minus the base.
   */
  unreachableKnowledgeBaseCount: number;
  /**
   * Did the RESOLVING caller write this template? (G-1, 2026-08-22.)
   *
   * ⚠ THE ONE EXCEPTION TO "no ownership in a launch payload": the desktop's
   * ROLE block wears a different SECURITY HEADER for another member's
   * instructions than for the operator's own. A COMPUTED BOOLEAN, not
   * `createdBy` — a raw creator id is a fact the launcher has no use for.
   * `false` once the author leaves (`created_by` is `SET NULL`), which is the
   * correct direction: nobody left can vouch for it.
   */
  authoredByCaller: boolean;
}

/**
 * Request-scoped context built at the route boundary from auth metadata.
 * Mirrors `SkillContext` / `KnowledgeContext` field for field so the three
 * services read the same way.
 */
export interface AgentTemplateContext {
  workspaceId: string;
  userId: string;
  /** API-key callers = agent, session callers = user. */
  source: "user" | "agent";
  /** Caller's workspace role. Null when auth didn't resolve one → treated as
   *  non-admin, so team-scoped templates require a linked team. */
  role: Role | null;
  /**
   * Workspace this credential is fenced to. ⚠ *WHICH WORKSPACE* ONLY — it is
   * NOT the visibility answer, which is the F-333/F-336 defect (fixed
   * 2026-08-27). See {@link AgentTemplateContext.credentialSubjectUserId}.
   */
  apiKeyWorkspaceId?: string | null;
  /**
   * WHOSE REACH this credential inherits (`mcp_tokens.subject_user_id`); `null`
   * = nobody in particular. ⚠ Read ONLY through
   * `shared/auth/credential-audience.ts › isSharedCredential`. A credential that
   * may be passed between humans (CI runners, service accounts) gets NO private
   * visibility — M-10, same rule as `canSeeSkill` / `canSeeBase`. A container
   * SESSION is one human's session and is not that.
   */
  credentialSubjectUserId: string | null;
}
