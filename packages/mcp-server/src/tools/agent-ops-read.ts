/** `dopl_agent` read ops: list, get. Non-mutating — they resolve an identity ref and render it. */

import { callRef } from "../call-ref.js";
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
  identityAudience,
  identityRow,
  identityScopes,
} from "./agent-shared.js";
import { isErr } from "./channel-shared.js";
import {
  DESTINATION_HEADINGS,
  resolveHomeChannelContainer,
} from "./container-destination.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";

/** Headings per offered visibility, workspace only; a home channel uses `DESTINATION_HEADINGS`. */
const VISIBILITY_HEADINGS: Record<OfferedIdentityVisibility, string> = {
  private: "Private to you",
  workspace: "Shared with the whole workspace",
};

const OFFERED_VISIBILITIES = new Set<string>(IDENTITY_VISIBILITY_VALUES);

/** Heading for an unoffered stored visibility (`team`): the row still shows, the axis is not taught. */
const OTHER_HEADING = "Shared";

/** Stale-cache fallback: a payload without `homeScopedIdentityIds` means no container grouping. */
const EMPTY_IDENTITY_IDS: readonly string[] = Object.freeze([]);

/** op="list": groups by container first (personal rows via `homeScopedIdentityIds`), visibility second. */
export async function opList(
  client: DoplClient,
  /** Optional: absent means "not known" — falls back to the workspace visibility headings. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  const payload = await client.listAgentIdentitiesPayload();
  const identities = payload.identities;
  if (identities.length === 0) {
    return ok(
      `No agent identities visible to you here. ${IDENTITIES_SCOPE_NOTE}\n\nCreate one with \`${callRef("agent.create", {}, { quote: "'" })}\`.`,
    );
  }
  const personalIds = new Set(payload.homeScopedIdentityIds ?? EMPTY_IDENTITY_IDS);
  const personal = identities.filter((ident) => personalIds.has(ident.id));
  const here = identities.filter((ident) => !personalIds.has(ident.id));
  const inHomeChannel = await resolveHomeChannelContainer(client, directory);

  // Rows with an unoffered visibility (`team`) fall into a trailing bucket — never silently dropped.
  const hereGroups: Array<readonly [string, AgentIdentity[]]> = inHomeChannel
    ? [
        [DESTINATION_HEADINGS.shared, here.filter((ident) => ident.visibility === "workspace")],
        [DESTINATION_HEADINGS.legacy, here.filter((ident) => ident.visibility !== "workspace")],
      ]
    : [
        ...IDENTITY_VISIBILITY_VALUES.map(
          (v) => [VISIBILITY_HEADINGS[v], here.filter((ident) => ident.visibility === v)] as const,
        ),
        [OTHER_HEADING, here.filter((ident) => !OFFERED_VISIBILITIES.has(ident.visibility))],
      ];
  // The addressed container's rows first, so the heading order does not read as another container's roster.
  const groups: Array<readonly [string, AgentIdentity[]]> = [
    ...hereGroups,
    [DESTINATION_HEADINGS.personal, personal],
  ];
  const lines = ["## Agent identities\n"];
  for (const [heading, rows] of groups) {
    if (rows.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const ident of rows) {
      const audience = identityAudience(ident, {
        personal: personalIds.has(ident.id),
        inHomeChannel: inHomeChannel !== null,
      });
      lines.push(identityRow(ident, audience));
    }
    lines.push("");
  }
  lines.push(IDENTITIES_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  ref: string,
  // Only the untrusted framing reads this; visibility is the server's decision.
  callerUserId: string | null = null,
  /** Clips the INSTRUCTIONS body, and says so. */
  maxChars?: number,
): Promise<ToolResponse> {
  const identity = await resolveIdentityOr(client, ref);
  if (isErr(identity)) return identity;
  const foreign = isForeignAuthored(
    // An identity row has no `lastEditedBy` column: the slot is absent, not unknown.
    { createdBy: identity.createdBy, lastEditedBy: null },
    callerUserId,
  );
  const lines = [
    `# ${inlineOr(identity.name, NO_NAME)}`,
    `id: \`${identity.id}\` · ${identity.visibility} · runtime ${identity.runtime ? inlineOr(identity.runtime, NO_NAME) : "(the channel's)"} · model ${identity.model ? inlineOr(identity.model, NO_NAME) : "(the runtime's default)"}`,
    // The version is printed on the header rows, so a clipped instructions body cannot hide it.
    `Version: \`${identity.updatedAt}\` (pass as expected_version to ${callRef("agent.update", {}, { form: "op" })})`,
    ...(identity.description ? [inlineOr(identity.description, "")] : []),
  ];
  const scopes = identityScopes(identity);
  if (scopes.length > 0) {
    lines.push("", "## Attached knowledge");
    for (const scope of scopes) {
      // One line per scope with its path: the path is what tells two folders of one base apart.
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
    lines.push(
      "",
      `_Only the knowledge YOU can see is listed. At launch the operator's own machine resolves this list again under THEIR visibility, so a base you can read and they cannot is simply omitted there._`,
    );
  }
  if (identity.fields.length > 0) {
    lines.push("", "## Custom fields");
    for (const f of identity.fields) {
      // The type is shown only when it is not the default, so a text-only identity reads as before.
      const typed = f.type && f.type !== "text" ? ` (${f.type})` : "";
      lines.push(`- ${inlineOr(f.key, NO_NAME)}${typed}: ${inlineOr(f.value, "`(empty)`")}`);
    }
  }
  lines.push("", "## Instructions");
  lines.push("", "---", "");
  // Somebody else's instructions are fenced (per-response close tag); the caller's own render bare.
  // Clip the instructions BEFORE fencing, never after: clipping a fenced block would cut its close tag.
  const whole = identity.instructions ?? "_No instructions set._";
  const { body: instructions, notice } = clipToMaxChars(whole, maxChars);
  lines.push(
    ...(foreign && identity.instructions
      ? fenceBody(instructions, "agent instructions by another member")
      : [instructions]),
  );
  // Outside the fence, so the notice is visibly this server's.
  if (notice) lines.push("", notice);
  return ok(lines.join("\n"));
}
