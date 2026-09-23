/**
 * `dopl_agent` READ op handlers: list, get. Non-mutating — they resolve a
 * identity ref (or a shelf) and render it. Routed from the registrar in
 * `agent.ts`.
 */

import type { AgentIdentity, DoplClient } from "@dopl/client";
import { inlineOr, isForeignAuthored, NO_NAME } from "./narration.js";
import { fenceBody } from "./untrusted-fence";
import { ok, type ToolResponse } from "./respond.js";
import { clipToMaxChars } from "./response-size.js";
import {
  resolveIdentityOr,
  IDENTITY_VISIBILITY_VALUES,
  type OfferedIdentityVisibility,
  IDENTITIES_SCOPE_NOTE,
  identityRow,
} from "./agent-shared.js";
import { isErr } from "./channel-shared.js";
import {
  DESTINATION_HEADINGS,
  resolveHomeChannelContainer,
} from "./container-destination.js";
import { AUDIENCE_LABELS, type AudienceLabel } from "./audience-label.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";

/** One heading per OFFERED visibility, in the order `op="list"` prints them.
 *  ⚠ THE WORKSPACE VOCABULARY, and it is only ever printed for a workspace —
 *  inside a home channel `container-destination.ts › DESTINATION_HEADINGS`
 *  answers instead. */
const VISIBILITY_HEADINGS: Record<OfferedIdentityVisibility, string> = {
  private: "Private to you",
  workspace: "Shared with the whole workspace",
};

/** ⚠ **THE ROW LABEL, PAIRED WITH THE HEADING ABOVE IT AND NOT WITH THE COLUMN**
 *  (S21/S23) — see `audience-label.ts`. A workspace heading and a home-channel
 *  heading answer "who can see this" differently for the SAME stored value. */
const WORKSPACE_AUDIENCES: Record<OfferedIdentityVisibility, AudienceLabel> = {
  private: AUDIENCE_LABELS.you,
  workspace: AUDIENCE_LABELS.workspace,
};

const OFFERED_VISIBILITIES = new Set<string>(IDENTITY_VISIBILITY_VALUES);

/** The heading for every OTHER stored visibility. ⚠ It names no axis on
 *  purpose: it exists so a row SHOWS, not so a retired sharing model gets taught
 *  back to the reader one heading at a time. */
const OTHER_HEADING = "Shared";

/** ⚠ §8 STALE-CACHE, SPELLED INLINE. A list payload from a bundle that predates
 *  the sibling key carries NO `homeScopedIdentityIds` at all, and the fail-safe
 *  reading of "I do not know which container this row is in" is NO GROUPING —
 *  never "personal" and never "the channel's". One frozen empty, so the fallback
 *  is one allocation and cannot be mutated into a real answer. */
const EMPTY_IDENTITY_IDS: readonly string[] = Object.freeze([]);

/**
 * ⚠ **THE `shelf` ARGUMENT AND ITS `· personal` LABEL LEFT ON 2026-09-02**
 * (slice B15, ruling B10) — the twin of `dopl_kb(op="list_bases")`'s, for the
 * same reason: a personal identity is an ordinary row in the caller's own
 * `kind='personal'` CONTAINER, so "which shelf" is the tenancy the call is
 * already in.
 *
 * 🔒 **AND THE ARGUMENT THAT RETIRED THE LABEL STOPPED BEING TRUE ON 2026-09-06**
 * (invariant 4 of #1077, closed here 2026-09-18). `personal-container.ts ›
 * resolveShelfScope` widened an UNFILTERED read to the calling container PLUS
 * the caller's own personal one, so this list has held rows from TWO tenancies
 * since that day while its heading still said "Private to you" over all of them
 * — one undifferentiated bucket spanning both destinations. **The container is
 * the first axis now**, off the `homeScopedIdentityIds` sibling key this op used
 * to discard, and the visibility axis only ever splits what is left.
 */
export async function opList(
  client: DoplClient,
  /** ⚠ OPTIONAL — see `container-destination.ts ›
   *  resolveHomeChannelContainer`: absent means "not known", and the list falls
   *  back to the workspace's own visibility headings. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  const payload = await client.listAgentIdentitiesPayload();
  const identities = payload.identities;
  if (identities.length === 0) {
    return ok(
      `No agent identities visible to you here. ${IDENTITIES_SCOPE_NOTE}\n\nCreate one with \`dopl_agent(op='create')\`.`,
    );
  }
  // 🔒 **CONTAINER FIRST, VISIBILITY SECOND** (2026-09-18). The two destinations
  // are two CONTAINERS, so that is the axis a caller acts on; visibility only
  // says who inside one of them may use the row.
  const personalIds = new Set(payload.homeScopedIdentityIds ?? EMPTY_IDENTITY_IDS);
  const personal = identities.filter((t) => personalIds.has(t.id));
  const here = identities.filter((t) => !personalIds.has(t.id));
  const inHomeChannel = await resolveHomeChannelContainer(client, directory);

  // ⚠ GROUPED BY VISIBILITY **WITHIN A WORKSPACE** because that is the axis a
  // caller acts on there ("the private one is mine, the workspace one is
  // everyone's") — and it is what makes an ambiguity refusal actionable when two
  // rows share a name.
  //
  // ⚠ A ROW IS NEVER DROPPED FOR HAVING A VISIBILITY THIS SURFACE NO LONGER
  // OFFERS. The write enum lost `team` (`agent-shared.ts ›
  // IDENTITY_VISIBILITY_VALUES`) while the column kept it, so grouping by a
  // fixed table of the OFFERED values would have made any surviving row
  // invisible with no error anywhere — the silent-drop shape, not a retirement.
  // Unoffered values fall through to one trailing bucket that names no axis.
  // ⚠ THE SAME RULE HOLDS IN A CHANNEL, where the trailing bucket is the LEGACY
  // one: everything that is not `workspace` there is reachable from no surface.
  const hereGroups: Array<readonly [string, AgentIdentity[], AudienceLabel]> =
    inHomeChannel
      ? [
          [
            DESTINATION_HEADINGS.shared,
            here.filter((t) => t.visibility === "workspace"),
            AUDIENCE_LABELS.channel,
          ],
          [
            DESTINATION_HEADINGS.legacy,
            here.filter((t) => t.visibility !== "workspace"),
            AUDIENCE_LABELS.nobody,
          ],
        ]
      : [
          ...IDENTITY_VISIBILITY_VALUES.map(
            (v) =>
              [
                VISIBILITY_HEADINGS[v],
                here.filter((t) => t.visibility === v),
                WORKSPACE_AUDIENCES[v],
              ] as const,
          ),
          // ⚠ A visibility this surface does not offer (`team`) is a row we
          // cannot answer the audience question for — `not stated` rather than
          // a guess, on `channel-facts.ts › postureFacts`'s rule.
          [
            OTHER_HEADING,
            here.filter((t) => !OFFERED_VISIBILITIES.has(t.visibility)),
            "an audience this surface cannot state" as AudienceLabel,
          ],
        ];
  // ⚠ THE CHANNEL'S OWN ROWS FIRST, the personal shelf under them: the call
  // named a container, and a heading order that led with rows from somewhere
  // else would read as that container's roster.
  const groups: Array<readonly [string, AgentIdentity[], AudienceLabel]> = [
    ...hereGroups,
    [DESTINATION_HEADINGS.personal, personal, AUDIENCE_LABELS.you],
  ];
  const lines = ["## Agent identities\n"];
  for (const [heading, rows, audience] of groups) {
    if (rows.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of rows) lines.push(identityRow(t, audience));
    lines.push("");
  }
  lines.push(IDENTITIES_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  ref: string,
  // ⚠ Only the FRAMING reads this — visibility is the server's decision and it
  // already ran.
  callerUserId: string | null = null,
  /** A16: clip the INSTRUCTIONS body, and SAY so. */
  maxChars?: number,
): Promise<ToolResponse> {
  const identity = await resolveIdentityOr(client, ref);
  if (isErr(identity)) return identity;
  const foreign = isForeignAuthored(
    // ⚠ An identity row carries `createdBy` and no `lastEditedBy` column, so the
    // second author slot is genuinely absent rather than unknown — passing it
    // explicitly keeps `isForeignAuthored`'s fail-closed arms readable.
    { createdBy: identity.createdBy, lastEditedBy: null },
    callerUserId,
  );
  const lines = [
    `# ${inlineOr(identity.name, NO_NAME)}`,
    `id: \`${identity.id}\` · ${identity.visibility} · runtime ${identity.runtime ? inlineOr(identity.runtime, NO_NAME) : "(the channel's)"} · model ${identity.model ? inlineOr(identity.model, NO_NAME) : "(the runtime's default)"}`,
    // ⚠ **THE VERSION IS WHY `op="update"` CAN REFUSE A STALE WRITE**, and it is
    // rendered on the HEADER rows rather than at the end: this op clips its
    // INSTRUCTIONS body (A16), and a token printed after a clipped system prompt
    // is a token the caller may never see. Same line `dopl_kb`'s read_file and
    // `dopl_skill`'s read carry, for the same contract.
    `Version: \`${identity.updatedAt}\` (pass as expected_version to op="update")`,
    ...(identity.description ? [inlineOr(identity.description, "")] : []),
  ];
  // ⚠ **`knowledge` WINS AND THE BASE LIST IS THE FALLBACK** (2026-09-08). A
  // newer server sends both, the second being the base-level slice of the first,
  // so rendering both would list every whole-base attachment twice. An older one
  // sends only the base list, which is why the fallback is not dead code.
  const scopes =
    (identity.knowledge ?? []).length > 0
      ? (identity.knowledge ?? [])
      : identity.knowledgeBases.map((kb) => ({
          baseId: kb.id,
          baseName: kb.name,
          scope: "base" as const,
          path: kb.name,
        }));
  if (scopes.length > 0) {
    lines.push("", "## Attached knowledge");
    for (const scope of scopes) {
      // ⚠ ONE LINE PER SCOPE, WITH ITS PATH — the path is what distinguishes two
      // folders of one base, and a list that showed only base names would render
      // them as duplicates of each other.
      const what =
        scope.scope === "folder"
          ? " (folder, and everything under it)"
          : scope.scope === "entry"
            ? " (one entry)"
            : "";
      lines.push(
        `- ${inlineOr(scope.path || scope.baseName, NO_NAME)}${what} (base: \`${scope.baseId}\`)`,
      );
    }
    // ⚠ VIEWER-FILTERED, and saying so matters: the desktop resolves this list
    // again under the OPERATOR's credential at spawn, so what you see here is
    // not necessarily what a launched session gets.
    lines.push(
      "",
      `_Only the knowledge YOU can see is listed. At launch the operator's own machine resolves this list again under THEIR visibility, so a base you can read and they cannot is simply omitted there._`,
    );
  }
  if (identity.fields.length > 0) {
    lines.push("", "## Custom fields");
    for (const f of identity.fields) {
      lines.push(`- ${inlineOr(f.key, NO_NAME)}: ${inlineOr(f.value, "`(empty)`")}`);
    }
  }
  lines.push("", "## Instructions");
  // ⚠ BODY below the rule — the system prompt is the document this op exists to
  // hand over, and stripping its markdown breaks the feature. Framed above when
  // it is somebody else's; never neutralized.
  lines.push("", "---", "");
  // ⚠ FENCED WHEN IT IS SOMEBODY ELSE'S, and the fence sits HERE rather than at
  // the top of the result: it wraps the instructions block alone, so the header
  // rows above it are visibly this server's and the system prompt cannot be
  // read as continuing into them.
  // ⚠ **STILL CONDITIONAL, AND NO LONGER A BANNER** (A14). This block is a
  // SYSTEM PROMPT another member wrote, which is the reason `op="get"` takes a
  // caller id at all; it used to carry its own 340-char banner and now carries
  // `untrusted-fence.ts`'s one wording plus the part a banner could never do —
  // a close tag with a per-response random suffix, so the prompt cannot end its
  // own fence and claim the text after it. The caller's OWN identities render
  // bare: framing every one of them is noise on the common path, and noise is
  // how a security header stops being read.
  // ⚠ **CLIPPED BEFORE THE FENCE, NEVER AFTER** (A16). `fenceBody` closes with a
  // per-response random suffix; clipping the fenced block would cut that close
  // tag off and leave a system prompt somebody else wrote running to the end of
  // the response with nothing marking where it stops. The clip is a size knob,
  // not a licence to break the one structure that makes foreign instructions
  // safe to render at all.
  const whole = identity.instructions ?? "_No instructions set._";
  const { body: instructions, notice } = clipToMaxChars(whole, maxChars);
  lines.push(
    ...(foreign && identity.instructions
      ? fenceBody(instructions, "agent instructions by another member")
      : [instructions]),
  );
  // ⚠ OUTSIDE the fence, so the notice is visibly this server's — a line the
  // clipped prompt could otherwise be read as having written about itself.
  if (notice) lines.push("", notice);
  return ok(lines.join("\n"));
}
