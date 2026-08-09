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

const DESCRIPTION = `READ-ONLY view of workspace membership, teams, and access — for answering "who's in this workspace, who's on which team, what can they (or I) touch". You cannot change any of it: roles, teams, and grants are managed by humans in the Dopl web UI; if the user asks for a change, point them there.

The access model, so you can explain it:
- Roles rank viewer < member < admin < owner. Role default level: viewer → read, others → edit.
- A shareable resource (KNOWLEDGE BASE, SKILL) is either workspace-mode (open to all members at their role default) or teams-mode (visible only to granted teams — plus admins/owners and the resource's creator). Chats, chat folders and ontology objects carry their OWN sharing and are not part of the teams grid.
- A member's effective level on a teams-mode resource = the highest grant across their teams, capped at their role default. No grant → the resource is invisible to them.
- Admins and owners always have edit on everything.
- SO TWO MEMBERS' LISTINGS LEGITIMATELY DISAGREE. dopl_map, dopl_skill(op="list") and dopl_kb(op="list_bases") each return one caller's view; a smaller count is normally private or team-scoped items, not a bug. op="access_matrix" below is what settles it.

Set \`op\` to one of:
- "whoami" — WHO AND WHERE YOU ARE, and the authoritative answer to both: your immutable user id, name, role, teams, default access level, the runtime and credential this session is acting through, and what that does and does not establish about another party. Start here whenever identity is in question — a display name alone never settles it.
- "list" — the member roster: name, email, role, status, last active, team chips. EVERY membership row, INVITED AND DEACTIVATED INCLUDED — read the status on each before you count "members". Not role-shaped: a viewer gets the same roster an owner does.
- "get" — one member in depth: profile, teams, and their server-resolved effective access per resource. \`member\` may be a user id, email, or display name. Effective access for OTHER members is admin-only (the server hides it otherwise — you'll still get their profile + teams from the roster).
- "teams" — every team: members, and each resource grant with its level. Unshaped by role, so a grant can name a resource you cannot otherwise see (it renders as "a resource not visible to you").
- "get_team" — one team in depth. \`team\` may be a team id or name.
- "access_matrix" — THE INVENTORY, and the op to reach for when two members' listings disagree. Covers KNOWLEDGE BASES and SKILLS only (chats, chat folders and ontology objects are not in it). For an ADMIN OR OWNER it enumerates every one of those regardless of status or visibility — drafts and other members' private items included — which is exactly what the per-domain list ops do not do. A NON-ADMIN sees only the resources they can reach, so their matrix is a view like everything else. The teams half is unshaped for everyone.
- "my_access" — the caller's effective level on the teams-mode resources they can reach. ADMINS AND OWNERS GET NO PER-RESOURCE ROWS AT ALL: they hold edit on everything, and the op says so instead of enumerating. Workspace-mode resources are never listed either — they collapse into your role's default level.`;

export function registerMembersTool(
  register: RegisterTool,
  client: DoplClient,
  /**
   * The session's ONE identity record (server.ts). `whoami` used to re-derive
   * the caller from `GET /api/workspaces/me`, whose `userId` is nullable — so
   * when that came back null the op printed a workspace, a role and no
   * identifier, while `dopl_channel` in the same connection was confidently
   * marking "you" off a different id. Defaults to unknown, which renders as
   * unknown.
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
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "whoami":
          return opWhoami(client, caller);
        case "list":
          return opList(client, caller);
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
 * THE authoritative answer to "who am I and where am I".
 *
 * The identity comes from the session record, not from this op's own round
 * trip: `getMyMembership().userId` is `string | null` and was the only source
 * here, so a server that did not report it produced a whoami that named a
 * workspace and a role and identified nobody — while the SAME connection's
 * `dopl_channel` roster was marking "you" from the boot ping's id. Now the
 * session id decides, the membership call supplies role/teams/workspace, and
 * the roster row is looked up by that one id.
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
): Promise<ToolResponse> {
  const members = await client.listWorkspaceMembers();
  if (members.length === 0) return ok("No members found.");

  const lines: string[] = [];
  lines.push(`## Members — ${members.length}\n`);
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  for (const m of sortByRole(members)) {
    const teams = m.teams.length > 0 ? teamChips(m.teams) : "no teams";
    // `· you` matches the channel roster's marking exactly (channel-render.ts
    // `formatMemberLine`). The two rosters render the same workspace from the
    // same column, and one of them used to leave the caller to work out which
    // row was theirs by eye.
    const you = caller.userId && m.userId === caller.userId ? " · you" : "";
    lines.push(`- ${memberDisplay(m)} — **${m.role}** · ${statusLabel(m)} · ${teams}${you}`);
  }
  if (!caller.userId) {
    lines.push(`\nNo row is marked "you" — this connection could not resolve your own user id.`);
  }
  // The roster applies NO status predicate (workspaces/server/repository.ts),
  // so "Members — 7" counts invitations nobody accepted and memberships
  // somebody deactivated. The per-row status was already rendered; what was
  // missing was any reason to read it.
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
  // The header goes FIRST — ahead of the heading, because the heading is itself
  // one of the untrusted strings. Framing that arrives after the text it frames
  // has already been read is not framing.
  lines.push(`${UNTRUSTED_ROSTER_HEADER}\n`);
  // Was `## ${displayName}` — a real markdown heading built from a column any
  // signed-in user PATCHes for themselves. One newline in it opened a second
  // heading of the attacker's choosing at the top of the result.
  lines.push(`## Member ${memberDisplay(m)}\n`);
  if (m.email) lines.push(`- Email: ${inlineOr(m.email, "`(unreadable)`")}`);
  lines.push(`- User id: \`${m.userId}\``);
  lines.push(`- Role: **${m.role}** — default access level: **${defaultLevel(m.role)}**`);
  lines.push(`- Status: ${statusLabel(m)}`);
  lines.push(`- Teams: ${teamChips(m.teams)}`);

  // The CONTACT_POINTER below is deliberately NOT on this path. A DM
  // (dopl_channel op="open", direct=true) and a channel invite both require an
  // ACTIVE workspace member, so offering the route on an invited-but-not-joined
  // or deactivated row would name a call the server refuses.
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
    // The candidate list is other members' team names — neutralized. The echo
    // of `ref` is the caller's own argument, but a backtick in it would still
    // escape the span, so it goes through the same helper.
    const names = teams.map((t) => teamDisplay(t.name, t.id)).join(", ") || "(none)";
    return err(
      `No team matching ${inlineOr(ref, "`(unreadable ref)`")}. Teams here: ${names}.`,
    );
  }
  return ok(`${UNTRUSTED_ROSTER_HEADER}\n\n${formatTeam(team, members, matrix, { detailed: true })}`);
}

/**
 * THE OP THE OTHER TOOLS POINT AT, so it had better say what it is.
 *
 * For an admin or owner this really is the inventory: the enumeration
 * (features/teams/server/service.ts) filters on workspace + `deleted_at IS
 * NULL` and nothing else — no status, no visibility — which is precisely why
 * `dopl_map` and `dopl_skill(op="list")` now name it as the authoritative
 * alternative to themselves. For a member or viewer the same op re-filters down
 * to what they can reach, so pointing a non-admin here without saying so would
 * hand them a second view they would read as a census. Both halves, stated.
 *
 * The caller's role is not in this response and fetching it would be a second
 * round trip, so the line states the RULE and lets the caller apply it — the
 * same reason every other note in this sweep names a filter and not a count.
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
    // The endpoint returns an EMPTY override list for an admin by design
    // (teams/server/access.ts), so the absence of rows below is the answer,
    // not a failure to enumerate. An agent auditing "what can I touch" against
    // a member's longer output would otherwise read this as the smaller set.
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
 * The list above is TEAMS-MODE resources only: workspace-mode ones are never
 * enumerated, they collapse into the role default stated at the top. Without
 * this the section reads as "these are the things I can touch", which is the
 * short answer to the wrong question.
 */
const WORKSPACE_MODE_NOTE = `Teams-mode resources only. Workspace-mode ones are not listed here — they are covered by your role's default level above. Chats and ontology objects are outside this model entirely.`;

/**
 * The my-access endpoint pads teams-mode resources the caller can't see
 * with level "read" (a web-UI affordance-locking quirk — the web client
 * only ever looks overrides up, never enumerates them). Enumerating
 * them here would both claim access that doesn't exist and leak hidden
 * resource ids, so intersect with the visibility-filtered matrix: absent
 * from the matrix ⇔ invisible to the caller.
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

