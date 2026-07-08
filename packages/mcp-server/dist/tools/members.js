"use strict";
/**
 * `dopl_members` — READ-ONLY window onto workspace membership, teams,
 * and access. Mirrors exactly what the caller can see in the web UI at
 * their role; the server enforces every gate (other members' effective
 * access is admin-only, the access matrix is filtered for non-admins).
 *
 * Deliberately has NO write ops and NO admin twin: membership, team,
 * and access changes are human decisions made in the Dopl web UI.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMembersTool = registerMembersTool;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const DESCRIPTION = `READ-ONLY view of workspace membership, teams, and access — for answering "who's in this workspace, who's on which team, what can they (or I) touch". You cannot change any of it: roles, teams, and grants are managed by humans in the Dopl web UI; if the user asks for a change, point them there.

The access model, so you can explain it:
- Roles rank viewer < member < admin < owner. Role default level: viewer → read, others → edit.
- Every resource (knowledge base, workflow, chat, …) is either workspace-mode (open to all members at their role default) or teams-mode (visible only to granted teams — plus admins/owners and the resource's creator).
- A member's effective level on a teams-mode resource = the highest grant across their teams, capped at their role default. No grant → the resource is invisible to them.
- Admins and owners always have edit on everything.

Set \`op\` to one of:
- "whoami" — the caller's own membership: role, teams, default access level.
- "list" — the member roster: name, email, role, status, last active, team chips.
- "get" — one member in depth: profile, teams, and their server-resolved effective access per resource. \`member\` may be a user id, email, or display name. Effective access for OTHER members is admin-only (the server hides it otherwise — you'll still get their profile + teams from the roster).
- "teams" — every team: members, and each resource grant with its level.
- "get_team" — one team in depth. \`team\` may be a team id or name.
- "access_matrix" — the full teams × resources grid with each resource's scope mode. Non-admins see only resources visible to them.
- "my_access" — the caller's effective level on every resource they can see (the "what can I actually do" answer).`;
function registerMembersTool(register, client) {
    register("dopl_members", DESCRIPTION, {
        op: zod_1.z
            .enum(["whoami", "list", "get", "teams", "get_team", "access_matrix", "my_access"])
            .describe("Operation to perform."),
        member: zod_1.z
            .string()
            .optional()
            .describe("op=get (required): the member — user id, email, or display name."),
        team: zod_1.z
            .string()
            .optional()
            .describe("op=get_team (required): the team — id or name."),
    }, async (args) => {
        switch (args.op) {
            case "whoami":
                return opWhoami(client);
            case "list":
                return opList(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["member"]);
                if (miss)
                    return miss;
                return opGet(client, args.member);
            }
            case "teams":
                return opTeams(client);
            case "get_team": {
                const miss = (0, respond_1.missingParams)("get_team", args, ["team"]);
                if (miss)
                    return miss;
                return opGetTeam(client, args.team);
            }
            case "access_matrix":
                return opAccessMatrix(client);
            case "my_access":
                return opMyAccess(client);
        }
    });
}
// ─── Op handlers ────────────────────────────────────────────────────
async function opWhoami(client) {
    const me = await client.getMyMembership();
    const [members, access, matrix] = await Promise.all([
        client.listWorkspaceMembers(),
        client.getMyAccess(),
        client.getAccessMatrix(),
    ]);
    const self = me.userId
        ? members.find((m) => m.userId === me.userId)
        : undefined;
    const reachable = visibleOverrides(access, matrix);
    const lines = [];
    lines.push(`## You in **${me.workspace.name}**\n`);
    if (self)
        lines.push(`- ${memberDisplay(self)}`);
    lines.push(`- Role: **${me.role}** — default access level: **${defaultLevel(me.role)}**`);
    if (self) {
        lines.push(self.teams.length > 0
            ? `- Teams: ${self.teams.map((t) => t.name).join(", ")}`
            : `- Teams: none`);
    }
    else {
        lines.push(`- Teams: (unknown — this server doesn't report your user id)`);
    }
    if (reachable.length > 0) {
        lines.push(`- Team-scoped resources you can reach: ${reachable.length} (op="my_access" for the list)`);
    }
    if (me.role === "owner" || me.role === "admin") {
        lines.push(`- As ${me.role} you have edit access to everything, and can inspect any member's effective access (op="get").`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opList(client) {
    const members = await client.listWorkspaceMembers();
    if (members.length === 0)
        return (0, respond_1.ok)("No members found.");
    const lines = [];
    lines.push(`## Members — ${members.length}\n`);
    for (const m of sortByRole(members)) {
        const teams = m.teams.length > 0 ? m.teams.map((t) => t.name).join(", ") : "no teams";
        lines.push(`- ${memberDisplay(m)} — **${m.role}** · ${statusLabel(m)} · ${teams}`);
    }
    lines.push(`\nUse dopl_members(op="get", member=...) for one member's teams + effective access.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, ref) {
    const members = await client.listWorkspaceMembers();
    const match = matchMember(members, ref);
    if ("error" in match)
        return (0, respond_1.err)(match.error);
    const m = match.member;
    const lines = [];
    lines.push(`## ${m.displayName || m.email || m.userId}\n`);
    if (m.email)
        lines.push(`- Email: ${m.email}`);
    lines.push(`- User id: \`${m.userId}\``);
    lines.push(`- Role: **${m.role}** — default access level: **${defaultLevel(m.role)}**`);
    lines.push(`- Status: ${statusLabel(m)}`);
    lines.push(m.teams.length > 0
        ? `- Teams: ${m.teams.map((t) => t.name).join(", ")}`
        : `- Teams: none`);
    if (m.status !== "active") {
        lines.push(``);
        lines.push(`_No effective access — this membership is ${m.status === "pending" ? "still invited (not yet accepted)" : "deactivated"}._`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    try {
        const rows = await client.getMemberAccess(m.userId);
        lines.push(``);
        lines.push(formatEffectiveAccess(rows, m.role));
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            lines.push(``);
            lines.push(`_Effective access for other members is visible to admins/owners only._`);
        }
        else {
            throw e;
        }
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opTeams(client) {
    const [teams, members, matrix] = await Promise.all([
        client.listWorkspaceTeams(),
        client.listWorkspaceMembers(),
        client.getAccessMatrix(),
    ]);
    if (teams.length === 0) {
        return (0, respond_1.ok)("No teams in this workspace yet. Teams are created in the web UI (Members → Teams).");
    }
    const lines = [];
    lines.push(`## Teams — ${teams.length}\n`);
    for (const team of teams) {
        lines.push(formatTeam(team, members, matrix));
        lines.push(``);
    }
    return (0, respond_1.ok)(lines.join("\n").trimEnd());
}
async function opGetTeam(client, ref) {
    const [teams, members, matrix] = await Promise.all([
        client.listWorkspaceTeams(),
        client.listWorkspaceMembers(),
        client.getAccessMatrix(),
    ]);
    const lower = ref.trim().toLowerCase();
    const team = teams.find((t) => t.id === ref) ??
        teams.find((t) => t.name.toLowerCase() === lower);
    if (!team) {
        const names = teams.map((t) => t.name).join(", ") || "(none)";
        return (0, respond_1.err)(`No team matching "${ref}". Teams here: ${names}.`);
    }
    return (0, respond_1.ok)(formatTeam(team, members, matrix, { detailed: true }));
}
async function opAccessMatrix(client) {
    const matrix = await client.getAccessMatrix();
    if (matrix.resources.length === 0) {
        return (0, respond_1.ok)("No shareable resources visible to you in this workspace.");
    }
    const lines = [];
    lines.push(`## Access matrix — ${matrix.resources.length} resources × ${matrix.teams.length} teams\n`);
    lines.push(`Workspace-mode resources are open to every member at their role default; teams-mode resources list their grants (admins/owners and the creator always retain access).\n`);
    for (const r of matrix.resources) {
        if (r.accessMode === "workspace") {
            lines.push(`- **${r.name}** (${typeLabel(r.resourceType)}) — workspace-wide`);
            continue;
        }
        const grants = matrix.teams
            .map((t) => ({ team: t, grant: findGrant(t, r.resourceType, r.resourceId) }))
            .filter((x) => x.grant !== undefined);
        const detail = grants.length > 0
            ? grants.map((g) => `${g.team.name}: ${g.grant.level}`).join(" · ")
            : "no team grants (creator + admins only)";
        lines.push(`- **${r.name}** (${typeLabel(r.resourceType)}) — teams-only · ${detail}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opMyAccess(client) {
    const [me, access, matrix] = await Promise.all([
        client.getMyMembership(),
        client.getMyAccess(),
        client.getAccessMatrix(),
    ]);
    const lines = [];
    lines.push(`## Your access in **${me.workspace.name}**\n`);
    lines.push(`- Role **${me.role}** → default level **${access.defaultLevel}** on workspace-mode resources.`);
    if (me.role === "owner" || me.role === "admin") {
        lines.push(`- As ${me.role}: edit on everything, including teams-only resources.`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    const reachable = visibleOverrides(access, matrix);
    if (reachable.length === 0) {
        lines.push(`- No teams-only resources are shared with you.`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    const nameOf = new Map(matrix.resources.map((r) => [`${r.resourceType}:${r.resourceId}`, r.name]));
    lines.push(`- Teams-only resources you can reach:`);
    for (const o of reachable) {
        const name = nameOf.get(`${o.resourceType}:${o.resourceId}`) ?? `\`${o.resourceId}\``;
        lines.push(`  - ${name} (${typeLabel(o.resourceType)}) — ${o.level}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * The my-access endpoint pads teams-mode resources the caller can't see
 * with level "read" (a web-UI affordance-locking quirk — the web client
 * only ever looks overrides up, never enumerates them). Enumerating
 * them here would both claim access that doesn't exist and leak hidden
 * resource ids, so intersect with the visibility-filtered matrix: absent
 * from the matrix ⇔ invisible to the caller.
 */
function visibleOverrides(access, matrix) {
    const visible = new Set(matrix.resources.map((r) => `${r.resourceType}:${r.resourceId}`));
    return access.overrides.filter((o) => visible.has(`${o.resourceType}:${o.resourceId}`));
}
// ─── Formatting helpers ─────────────────────────────────────────────
const ROLE_ORDER = { owner: 0, admin: 1, member: 2, viewer: 3 };
function sortByRole(members) {
    return [...members].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        (a.displayName || a.email || "").localeCompare(b.displayName || b.email || ""));
}
function memberDisplay(m) {
    const name = m.displayName || m.email || m.userId;
    return m.displayName && m.email ? `**${name}** (${m.email})` : `**${name}**`;
}
function statusLabel(m) {
    if (m.status === "pending")
        return "invited";
    if (m.status === "revoked")
        return "deactivated";
    return m.lastSeenAt ? `active (last seen ${m.lastSeenAt.slice(0, 10)})` : "active";
}
function defaultLevel(role) {
    return role === "viewer" ? "read" : "edit";
}
const TYPE_LABELS = {
    knowledge_base: "knowledge base",
    workflow: "workflow",
    chat: "chat",
    chat_folder: "chat folder",
};
function typeLabel(resourceType) {
    return TYPE_LABELS[resourceType] ?? resourceType;
}
function findGrant(team, resourceType, resourceId) {
    return team.grants.find((g) => g.resourceType === resourceType && g.resourceId === resourceId);
}
function matchMember(members, ref) {
    const trimmed = ref.trim();
    const lower = trimmed.toLowerCase();
    const byId = members.find((m) => m.userId === trimmed);
    if (byId)
        return { member: byId };
    const byEmail = members.filter((m) => m.email?.toLowerCase() === lower);
    if (byEmail.length === 1)
        return { member: byEmail[0] };
    const byName = members.filter((m) => (m.displayName ?? "").toLowerCase().includes(lower));
    if (byName.length === 1)
        return { member: byName[0] };
    if (byName.length > 1) {
        const opts = byName.map((m) => memberDisplay(m)).join(", ");
        return { error: `"${ref}" matches several members: ${opts}. Use an email or user id.` };
    }
    return { error: `No member matching "${ref}". Use dopl_members(op="list") to see the roster.` };
}
function formatTeam(team, members, matrix, opts = {}) {
    const nameOf = new Map(members.map((m) => [m.userId, m.displayName || m.email || m.userId]));
    const resourceName = new Map(matrix.resources.map((r) => [`${r.resourceType}:${r.resourceId}`, r.name]));
    const lines = [];
    lines.push(`### ${team.name}${team.description ? ` — ${team.description}` : ""}`);
    const roster = team.memberIds.length > 0
        ? team.memberIds.map((id) => nameOf.get(id) ?? `\`${id}\``).join(", ")
        : "no members";
    lines.push(`- Members (${team.memberCount}): ${roster}`);
    if (team.grants.length === 0) {
        lines.push(`- Grants: none`);
    }
    else {
        lines.push(`- Grants:`);
        for (const g of team.grants) {
            // The matrix is visibility-filtered for non-admins, so a grant can
            // reference a resource the caller can't see — say so, don't leak.
            const name = resourceName.get(`${g.resourceType}:${g.resourceId}`) ??
                "(a resource not visible to you)";
            lines.push(`  - ${name} (${typeLabel(g.resourceType)}) — ${g.level}`);
        }
    }
    if (opts.detailed) {
        lines.push(`- Team id: \`${team.id}\``);
    }
    return lines.join("\n");
}
function formatEffectiveAccess(rows, role) {
    const lines = [];
    lines.push(`### Effective access`);
    if (role === "owner" || role === "admin") {
        lines.push(`_${role} — edit on everything._`);
        return lines.join("\n");
    }
    if (rows.length === 0) {
        lines.push(`_No shareable resources in this workspace yet._`);
        return lines.join("\n");
    }
    for (const r of rows) {
        const via = r.viaTeam ? ` (via team ${r.viaTeam.name})` : "";
        const level = r.level === null ? "no access" : r.level;
        lines.push(`- ${r.resourceName} (${typeLabel(r.resourceType)}) — **${level}**${via}`);
    }
    return lines.join("\n");
}
