/**
 * `dopl_members` — READ-ONLY window onto workspace membership, teams,
 * and access. Mirrors exactly what the caller can see in the web UI at
 * their role; the server enforces every gate (other members' effective
 * access is admin-only, the access matrix is filtered for non-admins).
 *
 * Deliberately has NO write ops and NO admin twin: membership, team,
 * and access changes are human decisions made in the Dopl web UI.
 */

import { z } from "zod";
import type { AccessMatrix, DoplClient, MyAccess } from "@dopl/client";
import { inlineOr } from "./narration";
import {
  identityLine,
  sessionLines,
  LOCUS_NOTE,
  UNKNOWN_CALLER,
  type CallerIdentity,
} from "./identity";
import {
  CONTACT_POINTER,
  defaultLevel,
  formatEffectiveAccess,
  formatTeam,
  grantDetail,
  matchMember,
  memberDisplay,
  memberListLine,
  pruneRetiredResources,
  resourceLabel,
  sortByRole,
  statusLabel,
  teamChips,
  teamDisplay,
  typeLabel,
  UNTRUSTED_ROSTER_HEADER,
} from "./members-render";
import { err, ok, isNotFound, missingParams, type RegisterTool, type ToolResponse } from "./respond";
import { FIELDS_FIELD, fieldFilter } from "./response-size";
import { MEMBERS_ERRORS } from "./tool-errors";
import { composeDescription, DESCRIPTION_MAX_CHARS } from "./tool-style";

/**
 * ⚠ RENDERED, NOT WRITTEN — `tool-style.ts › composeDescription` holds the
 * order for every tool on this surface and refuses, at import, a headline over
 * its window or prose over its cap.
 *
 * ⚠ WHAT LEFT: every "Requires: …" clause, because each param's own
 * `.describe()` already names the ops that require it, and a description and
 * its arg descriptions are BOTH pushed on every connection.
 */
const DESCRIPTION = composeDescription({
  headline:
    "Workspace membership, teams and effective access as your role sees them — chats and ontology objects are not in this model.",
  policy:
    "Read-only: roles, teams and grants are edited by humans in the web UI.",
  routing: [
    "Use dopl_channel to reach a member; this only describes them.",
  ],
  body: [
    `Set \`op\` to one of:
- "whoami" — your user id, role, teams, default level, and the runtime and credential this session acts through.
- "list" — the roster: role, status, last active, teams. INVITED and DEACTIVATED rows are included — read the status before counting.
- "get" — one member's profile, teams and effective access; for OTHERS, admin-only.
- "teams" — each team's members and grants; a grant can name a resource you cannot otherwise see.
- "get_team" — one team in depth.
- "access_matrix" — KNOWLEDGE BASES and SKILLS only. For an ADMIN OR OWNER it enumerates those at any status or visibility; a NON-ADMIN sees only what they can reach, so it is a view like the rest.
- "my_access" — your level on the teams-mode resources you can reach. ADMINS AND OWNERS GET NO PER-RESOURCE ROWS — they hold edit on everything.`,
  ],
  errors: MEMBERS_ERRORS,
  examples: [
    { op: "whoami" },
    { op: "list" },
    { op: "get", member: "dana@acme.io" },
    { op: "access_matrix" },
  ],
  cap: DESCRIPTION_MAX_CHARS,
});

export function registerMembersTool(
  register: RegisterTool,
  client: DoplClient,
  /**
   * ⚠ The session's ONE identity record. Re-deriving the caller from
   * `GET /api/workspaces/me` (nullable `userId`) prints a workspace and a role
   * with no identifier, while `dopl_channel` on the same connection marks "you"
   * off a different id. Defaults to unknown, which renders as unknown.
   */
  caller: CallerIdentity = UNKNOWN_CALLER,
): void {
  register(
    "dopl_members",
    DESCRIPTION,
    {
      op: z
        .enum(["whoami", "list", "get", "teams", "get_team", "access_matrix", "my_access"])
        .describe("Operation to perform."),
      member: z
        .string()
        .optional()
        .describe("op=get (required): the member — user id, email, or display name."),
      team: z
        .string()
        .optional()
        .describe("op=get_team (required): the team — id or name."),
      // ⚠ A16's response-size knob. ONE `.describe()`, in `response-size.ts`,
      // shared with every tool that takes a projection — and the user id is
      // outside it by construction (Samuel's ruling).
      fields: FIELDS_FIELD,
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "whoami":
          return opWhoami(client, caller);
        case "list":
          return opList(client, caller, args.fields);
        case "get": {
          const miss = missingParams("get", args, ["member"]);
          if (miss) return miss;
          return opGet(client, args.member as string);
        }
        case "teams":
          return opTeams(client);
        case "get_team": {
          const miss = missingParams("get_team", args, ["team"]);
          if (miss) return miss;
          return opGetTeam(client, args.team as string);
        }
        case "access_matrix":
          return opAccessMatrix(client);
        case "my_access":
          return opMyAccess(client);
      }
    },
  );
}

// ─── Op handlers ────────────────────────────────────────────────────

/**
 * THE authoritative answer to "who am I and where am I". ⚠ Identity comes from
 * the SESSION record, never this op's own round trip: `getMyMembership().userId`
 * is `string | null`, so using it alone names a workspace and a role and
 * identifies nobody. The membership call supplies role/teams/workspace and the
 * roster row is looked up by the session id.
 */
async function opWhoami(
  client: DoplClient,
  caller: CallerIdentity,
): Promise<ToolResponse> {
  const me = await client.getMyMembership();
  const [members, access, matrix] = await Promise.all([
    client.listWorkspaceMembers(),
    client.getMyAccess(),
    client.getAccessMatrix().then(pruneRetiredResources),
  ]);
  const selfId = caller.userId ?? me.userId;
  const self = selfId ? members.find((m) => m.userId === selfId) : undefined;
  const reachable = visibleOverrides(access, matrix);

  const lines: string[] = [];
  lines.push(`## You in ${inlineOr(me.workspace.name, "`(unnamed workspace)`")}\n`);
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  lines.push(identityLine({ ...caller, userId: selfId }, self ? memberDisplay(self) : null));
  lines.push(`- Role: **${me.role}** — default access level: **${defaultLevel(me.role)}**`);
  lines.push(
    self
      ? `- Teams: ${teamChips(self.teams)}`
      : `- Teams: (unknown — no roster row resolved for your user id)`,
  );
  lines.push(...sessionLines(caller));
  if (reachable.length > 0) {
    lines.push(`- Team-scoped resources you can reach: ${reachable.length} (op="my_access" for the list)`);
  }
  if (me.role === "owner" || me.role === "admin") {
    lines.push(`- As ${me.role} you have edit access to everything, and can inspect any member's effective access (op="get").`);
  }
  lines.push(``, CONTACT_POINTER);
  lines.push(``, LOCUS_NOTE);
  return ok(lines.join("\n"));
}

async function opList(
  client: DoplClient,
  caller: CallerIdentity,
  fields?: string,
): Promise<ToolResponse> {
  const members = await client.listWorkspaceMembers();
  if (members.length === 0) return ok("No members found.");

  // ⚠ RESOLVED ONCE, NOT PER ROW. An unknown name is IGNORED rather than
  // refused (`response-size.ts › fieldFilter`): a mistyped one of four should
  // cost the caller that field, never the whole read.
  const wants = fieldFilter(fields);
  const lines: string[] = [];
  lines.push(`## Members — ${members.length}\n`);
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  for (const m of sortByRole(members)) {
    // ⚠ `· you` must match `channel-render.ts › formatMemberLine` exactly — the
    // two rosters render the same workspace from the same column.
    const you = caller.userId && m.userId === caller.userId ? " · you" : "";
    lines.push(memberListLine(m, you, wants));
  }
  if (!caller.userId) {
    lines.push(`\nNo row is marked "you" — this connection could not resolve your own user id.`);
  }
  // ⚠ The roster applies NO status predicate
  // (workspaces/server/repository.ts), so the count includes unaccepted
  // invitations and deactivated memberships — say so, or nobody reads the
  // per-row status.
  lines.push(
    `\n_Every membership row, INCLUDING invited-but-not-joined and deactivated ones — the count above is rows, not active people. Read the status on each._`,
  );
  lines.push(`\nUse dopl_members(op="get", member=...) for one member's teams + effective access.`);
  lines.push(`\n${CONTACT_POINTER}`);
  return ok(lines.join("\n"));
}

async function opGet(client: DoplClient, ref: string): Promise<ToolResponse> {
  const members = await client.listWorkspaceMembers();
  const match = matchMember(members, ref);
  if ("error" in match) return err(match.error);
  const m = match.member;

  const lines: string[] = [];
  // ⚠ Header goes FIRST, ahead of the heading — the heading is itself one of
  // the untrusted strings.
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  // ⚠ A raw `## ${displayName}` is a real heading built from a column any
  // signed-in user PATCHes for themselves — one newline opens a second heading.
  lines.push(`## Member ${memberDisplay(m)}\n`);
  if (m.email) lines.push(`- Email: ${inlineOr(m.email, "`(unreadable)`")}`);
  lines.push(`- User id: \`${m.userId}\``);
  lines.push(`- Role: **${m.role}** — default access level: **${defaultLevel(m.role)}**`);
  lines.push(`- Status: ${statusLabel(m)}`);
  lines.push(`- Teams: ${teamChips(m.teams)}`);

  // ⚠ CONTACT_POINTER deliberately NOT on this path: a DM and a channel invite
  // both require an ACTIVE member, so offering it on an
  // invited-but-not-joined or deactivated row names a call the server refuses.
  if (m.status !== "active") {
    lines.push(``);
    lines.push(
      `_No effective access — this membership is ${m.status === "pending" ? "still invited (not yet accepted)" : "deactivated"}._`,
    );
    return ok(lines.join("\n"));
  }

  try {
    const rows = await client.getMemberAccess(m.userId);
    lines.push(``);
    lines.push(formatEffectiveAccess(rows, m.role));
  } catch (e) {
    if (isNotFound(e)) {
      lines.push(``);
      lines.push(`_Effective access for other members is visible to admins/owners only._`);
    } else {
      throw e;
    }
  }
  lines.push(``, CONTACT_POINTER);
  return ok(lines.join("\n"));
}

async function opTeams(client: DoplClient): Promise<ToolResponse> {
  const [teams, members, matrix] = await Promise.all([
    client.listWorkspaceTeams(),
    client.listWorkspaceMembers(),
    client.getAccessMatrix().then(pruneRetiredResources),
  ]);
  if (teams.length === 0) {
    return ok("No teams in this workspace yet. Teams are created in the web UI (Members → Teams).");
  }
  const lines: string[] = [];
  lines.push(`## Teams — ${teams.length}\n`);
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  for (const team of teams) {
    lines.push(formatTeam(team, members, matrix));
    lines.push(``);
  }
  return ok(lines.join("\n").trimEnd());
}

async function opGetTeam(client: DoplClient, ref: string): Promise<ToolResponse> {
  const [teams, members, matrix] = await Promise.all([
    client.listWorkspaceTeams(),
    client.listWorkspaceMembers(),
    client.getAccessMatrix().then(pruneRetiredResources),
  ]);
  const lower = ref.trim().toLowerCase();
  const team =
    teams.find((t) => t.id === ref) ??
    teams.find((t) => t.name.toLowerCase() === lower);
  if (!team) {
    // Candidate list is other members' team names. ⚠ `ref` is the caller's own
    // argument, but a backtick still escapes the span.
    const names = teams.map((t) => teamDisplay(t.name, t.id)).join(", ") || "(none)";
    return err(
      `No team matching ${inlineOr(ref, "`(unreadable ref)`")}. Teams here: ${names}.`,
    );
  }
  return ok(`${UNTRUSTED_ROSTER_HEADER}\n\n${formatTeam(team, members, matrix, { detailed: true })}`);
}

/**
 * THE OP THE OTHER TOOLS POINT AT, so it must say what it is. For an admin or
 * owner it IS the inventory (`features/teams/server/service.ts` filters on
 * workspace + `deleted_at IS NULL`, no status, no visibility), which is why
 * `dopl_map` and `dopl_skill(op="list")` name it as the authoritative
 * alternative. ⚠ For a member or viewer the SAME op re-filters to what they can
 * reach, so both halves must be stated or a non-admin reads a second view as a
 * census. The caller's role is not in this response and fetching it is another
 * round trip, so state the RULE and let the caller apply it.
 */
const MATRIX_SCOPE_NOTE = `_Covers knowledge bases and skills only; chats, chat folders and ontology objects are not in this grid. If you are an ADMIN or OWNER this is the full inventory of those two, every status and every visibility included, and it is what settles a disagreement between two members' list ops. If you are a MEMBER or VIEWER it has been re-filtered to what you can reach, so it is a view like the rest. The teams half above is unfiltered for everyone._`;

async function opAccessMatrix(client: DoplClient): Promise<ToolResponse> {
  const matrix = pruneRetiredResources(await client.getAccessMatrix());
  if (matrix.resources.length === 0) {
    return ok(`No shareable resources visible to you in this workspace.\n\n${MATRIX_SCOPE_NOTE}`);
  }

  const lines: string[] = [];
  lines.push(`## Access matrix — ${matrix.resources.length} resources × ${matrix.teams.length} teams\n`);
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  lines.push(
    `Workspace-mode resources are open to every member at their role default; teams-mode resources list their grants (admins/owners and the creator always retain access).\n`,
  );
  for (const r of matrix.resources) {
    const label = `${resourceLabel(r.name)} (\`${r.resourceId}\` · ${typeLabel(r.resourceType)})`;
    if (r.accessMode === "workspace") {
      lines.push(`- ${label} — workspace-wide`);
      continue;
    }
    lines.push(`- ${label} — teams-only · ${grantDetail(matrix, r.resourceType, r.resourceId)}`);
  }
  lines.push("", MATRIX_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

async function opMyAccess(client: DoplClient): Promise<ToolResponse> {
  const [me, access, matrix] = await Promise.all([
    client.getMyMembership(),
    client.getMyAccess(),
    client.getAccessMatrix().then(pruneRetiredResources),
  ]);

  const lines: string[] = [];
  lines.push(`## Your access in ${inlineOr(me.workspace.name, "`(unnamed workspace)`")}\n`);
  lines.push(`- Role **${me.role}** → default level **${access.defaultLevel}** on workspace-mode resources.`);
  if (me.role === "owner" || me.role === "admin") {
    lines.push(`- As ${me.role}: edit on everything, including teams-only resources.`);
    // ⚠ The endpoint returns an EMPTY override list for an admin BY DESIGN
    // (teams/server/access.ts) — absence of rows is the answer, not a failure
    // to enumerate, and reads as the smaller set otherwise.
    lines.push(
      `\n_No per-resource rows are listed for an admin or owner: the empty list IS the answer, not a truncation. dopl_members(op="access_matrix") enumerates the resources themselves._`,
    );
    return ok(lines.join("\n"));
  }
  const reachable = visibleOverrides(access, matrix);
  if (reachable.length === 0) {
    lines.push(`- No teams-only resources are shared with you.`);
    lines.push(`\n_${WORKSPACE_MODE_NOTE}_`);
    return ok(lines.join("\n"));
  }
  const nameOf = new Map(
    matrix.resources.map((r) => [`${r.resourceType}:${r.resourceId}`, r.name]),
  );
  lines.push(``, UNTRUSTED_ROSTER_HEADER, ``);
  lines.push(`- Teams-only resources you can reach:`);
  for (const o of reachable) {
    const raw = nameOf.get(`${o.resourceType}:${o.resourceId}`);
    const name = raw ? resourceLabel(raw) : `\`${o.resourceId}\``;
    lines.push(`  - ${name} (\`${o.resourceId}\` · ${typeLabel(o.resourceType)}) — ${o.level}`);
  }
  lines.push(`\n_${WORKSPACE_MODE_NOTE}_`);
  return ok(lines.join("\n"));
}

/**
 * ⚠ TEAMS-MODE resources only — workspace-mode ones are never enumerated, they
 * collapse into the role default stated at the top. Without this the section
 * reads as "these are the things I can touch".
 */
const WORKSPACE_MODE_NOTE = `Teams-mode resources only. Workspace-mode ones are not listed here — they are covered by your role's default level above. Chats and ontology objects are outside this model entirely.`;

/**
 * ⚠ The my-access endpoint PADS teams-mode resources the caller cannot see with
 * level "read" (a web-UI affordance-locking quirk — the web client only looks
 * overrides up, never enumerates). Enumerating them claims access that does not
 * exist AND leaks hidden resource ids, so intersect with the
 * visibility-filtered matrix: absent from the matrix ⇔ invisible to the caller.
 */
function visibleOverrides(
  access: MyAccess,
  matrix: AccessMatrix,
): MyAccess["overrides"] {
  const visible = new Set(
    matrix.resources.map((r) => `${r.resourceType}:${r.resourceId}`),
  );
  return access.overrides.filter((o) =>
    visible.has(`${o.resourceType}:${o.resourceId}`),
  );
}

