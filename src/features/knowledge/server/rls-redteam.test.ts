/**
 * REDTEAM — the POLICY, alone, refuses what the TS predicate refuses, for each
 * of the first three knowledge tables (Wave B B7; Samuel's ruling B5, "RLS is
 * the fence"; RLS plan phase 1's *"a redteam case per table proving a non-member
 * gets zero rows"*).
 *
 * 🔒 WHY A REDTEAM SUITE IS THE DELIVERABLE AND NOT A NICETY. Until this slice,
 * every visibility rule on these tables was written TWICE — a TS predicate that
 * is the real fence and a policy that never runs, because every repository read
 * went through the service role. Two statements of one rule drift, and this pair
 * had: the live policy admitted a SHARED CREDENTIAL to a private row
 * (`canSeeBase`'s middle arm, M-10/F-336) and said nothing at all about
 * `access_mode = 'teams'`. A policy is allowed to be the fence only once
 * something proves it refuses the same things.
 *
 * ⚠ TWO HALVES, AND THE SECOND ONE DOES NOT RUN HERE.
 *
 *   * **The SQL half runs everywhere** — CI included. It replays every
 *     `supabase/migrations/*.sql` in filename order (= apply order) and asserts
 *     on the FINAL policy and function bodies. That is the same technique
 *     `knowledge/schema-sql.test.ts` and `channels/schema-sql.test.ts` use, and
 *     for the same reason: these are database facts no application test can
 *     reach while the app reads as service role.
 *   * **The LIVE half is SKIPPED unless `RLS_REDTEAM_LIVE=1`** and the Supabase
 *     env points at a stack whose migrations are applied. ⚠ IT HAS NEVER RUN:
 *     Docker was down on the authoring machine (`docker info` fails), so
 *     `supabase start` could not run and `20260919120000` has never been applied
 *     to any database. Wave A's seven migrations are unapplied for the same
 *     reason. The command that runs it is in the header of the skipped block.
 *
 * ⚠ A STRUCTURAL ASSERTION IS NOT A BEHAVIOURAL ONE, and this file says so
 * rather than reading as proof it is not. The SQL half proves the rule is
 * WRITTEN once and names every arm; only the live half proves Postgres AGREES.
 * Recorded as F-523.
 *
 * ⚠ COMMENTS ARE STRIPPED LINE-WISE before matching — `20260919120000`'s own
 * header quotes the policy bodies it replaces, and a scan that did not strip
 * them would pin a paragraph. Same choice, same caveat, as
 * `knowledge/schema-sql.test.ts`: take the hand scanner from
 * `channels/schema-sql.test.ts` if a migration touching these tables ever puts a
 * `--` inside a string literal.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOPL_CREDENTIAL_CLAIM } from "@/shared/supabase/caller-jwt";
import { callerScopedClient } from "@/shared/supabase/caller-client";
import { supabaseAdmin } from "@/shared/supabase/admin";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Every migration, filename-sorted (= apply order), comments removed. */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")),
  }));

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The policy bodies alive after replay, keyed `<table>.<policy>`.
 * ⚠ A `DROP` in a later file is as load-bearing as the `CREATE` — a scan that
 * read only the newest file would pass while a wider policy sat underneath.
 */
function livePolicies(): Map<string, string> {
  const live = new Map<string, string>();
  for (const file of FILES) {
    const events: Array<{ at: number; run: () => void }> = [];
    for (const m of file.sql.matchAll(
      /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      const body = squash(statementAt(file.sql, m.index));
      events.push({ at: m.index, run: () => live.set(key, body) });
    }
    for (const m of file.sql.matchAll(
      /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      events.push({ at: m.index, run: () => live.delete(key) });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  }
  return live;
}

/** The LAST `CREATE OR REPLACE FUNCTION <name>` body across the replay. */
function liveFunction(name: string): string {
  let found: string | null = null;
  for (const file of FILES) {
    for (const m of file.sql.matchAll(
      new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi")
    )) {
      // ⚠ Not `statementAt`: a function body is a `$tag$ … $tag$` literal whose
      // own semicolons sit at paren depth 0. Take the whole dollar-quoted body.
      const rest = file.sql.slice(m.index);
      const open = rest.match(/\$([a-z_]*)\$/i);
      if (!open) continue;
      const tag = open[0];
      const start = rest.indexOf(tag);
      const end = rest.indexOf(tag, start + tag.length);
      found = squash(rest.slice(0, end + tag.length));
    }
  }
  if (found === null) throw new Error(`no live definition of ${name}`);
  return found;
}

const POLICIES = livePolicies();
const SELECT_POLICY = {
  knowledge_bases: "knowledge_bases.knowledge_bases_member_select",
  knowledge_folders: "knowledge_folders.knowledge_folders_member_select",
  knowledge_entries: "knowledge_entries.knowledge_entries_member_select",
} as const;

/** "May the caller read this base?" — the rule, written once (STEP 4). */
const READABLE = "dopl_knowledge_base_readable";

describe("the read rule is stated ONCE", () => {
  it("every table's SELECT policy defers to the same function", () => {
    for (const key of Object.values(SELECT_POLICY)) {
      expect(POLICIES.get(key)).toContain(`${READABLE}(`);
    }
  });

  it("🔒 the claim the SQL reads is the claim the mint writes", () => {
    // Drift here is silent and one-directional: a renamed claim reads as
    // ABSENT, absent reads as "not shared", and every shared credential
    // quietly becomes a person again.
    expect(liveFunction("dopl_credential_is_shared")).toContain(
      `'${DOPL_CREDENTIAL_CLAIM}'`
    );
  });
});

describe("REDTEAM knowledge_bases — the policy alone", () => {
  const policy = () => POLICIES.get(SELECT_POLICY.knowledge_bases) ?? "";

  it("refuses a NON-MEMBER: membership is the outermost arm, and it is the caller-pinned form", () => {
    // ⚠ `is_current_workspace_member` (2-arg), never `is_workspace_member`
    // (3-arg): the 3-arg form lets the CALLER supply the user id and was the
    // membership oracle M-9 closed.
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(\s*kb\.workspace_id,\s*'viewer'\s*\)/i
    );
    expect(liveFunction(READABLE)).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("refuses a SHARED CREDENTIAL a private row — canSeeBase's middle arm (M-10 / F-336)", () => {
    const visibility = liveFunction("dopl_can_see_visibility");
    expect(visibility).toMatch(/p_visibility\s*=\s*'public'/i);
    expect(visibility).toMatch(/NOT\s+public\.dopl_credential_is_shared\(\)/i);
    expect(visibility).toMatch(/p_created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
    expect(liveFunction(READABLE)).toContain("dopl_can_see_visibility(kb.visibility, kb.created_by)");
  });

  it("refuses a TEAMS-MODE row with no grant — the arm the old policy did not have at all", () => {
    expect(liveFunction(READABLE)).toMatch(/access_mode IS DISTINCT FROM 'teams'/i);
    const teams = liveFunction("dopl_teams_mode_visible");
    expect(teams).toMatch(/is_current_workspace_member\(p_workspace_id, 'admin'\)/i);
    expect(teams).toMatch(/p_created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
    expect(teams).toMatch(/team_resource_access/i);
    expect(teams).toMatch(/tm\.user_id\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
  });

  it("does NOT hide soft-deleted rows — trash is a repository filter, not a fence", () => {
    expect(policy()).not.toMatch(/deleted_at/i);
  });
});

describe.each([
  ["knowledge_folders", SELECT_POLICY.knowledge_folders],
  ["knowledge_entries", SELECT_POLICY.knowledge_entries],
] as const)("REDTEAM %s — the policy alone", (table, key) => {
  const policy = () => POLICIES.get(key) ?? "";

  it("refuses a NON-MEMBER: the workspace arm is on the row itself", () => {
    expect(policy()).toMatch(
      /is_current_workspace_member\(workspace_id, 'viewer'::text\)/i
    );
  });

  it(`refuses a row whose BASE the caller cannot read — the 2026-08-26 entry-body leak, in the database`, () => {
    // `GET /api/knowledge/entries/[entryId]` checked the workspace and nothing
    // else, so a viewer read the body of an entry inside a private base. A
    // child policy that asked only for membership would reintroduce it.
    expect(policy()).toContain(`${READABLE}(knowledge_base_id)`);
  });

  it("inherits BOTH narrowing arms through that one call, rather than restating them", () => {
    expect(policy()).not.toMatch(/visibility\s*=/i);
    expect(policy()).not.toMatch(/access_mode/i);
    expect(`${table}`).toBe(table);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

/**
 * ⚠ SKIPPED-WITH-REASON, and the reason is a MEASUREMENT about this machine, not
 * a claim about the tree: Docker is down (`docker info` fails), so
 * `supabase start` cannot run, so `20260919120000` has never been applied and
 * nothing here has ever been executed.
 *
 * To run it, against a LOCAL stack only:
 *
 *   supabase start && supabase db reset            # applies every migration
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>  SUPABASE_SERVICE_ROLE_KEY=<service> \
 *   SUPABASE_JWT_SECRET=<jwt secret from `supabase status`> \
 *   RLS_REDTEAM_LIVE=1 npx vitest run src/features/knowledge/server/rls-redteam.test.ts
 *
 * ⚠ IT WRITES ROWS AND AUTH USERS. Local only — it refuses to run against a
 * non-loopback Supabase URL.
 */
const LIVE = process.env.RLS_REDTEAM_LIVE === "1";
const LOCAL_URL = /(localhost|127\.0\.0\.1)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");

describe.skipIf(!LIVE || !LOCAL_URL)(
  "REDTEAM (live) — a non-member gets ZERO rows through the caller client",
  () => {
    const scopeFor = (userId: string, shared = false) => ({
      userId,
      sharedCredential: shared,
      credentialWorkspaceId: shared ? "00000000-0000-4000-8000-000000000000" : null,
    });

    let ownerId = "";
    let outsiderId = "";
    let workspaceId = "";
    let privateBaseId = "";
    let publicBaseId = "";

    const admin = () => supabaseAdmin();

    async function makeUser(tag: string): Promise<string> {
      const { data, error } = await admin().auth.admin.createUser({
        email: `rls-redteam-${tag}-${Date.now()}@example.test`,
        password: `redteam-${tag}-${Date.now()}`,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error("no user");
      return data.user.id;
    }

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");

      const { data: ws, error: wsErr } = await admin()
        .from("workspaces")
        .insert({ owner_id: ownerId, name: "RLS redteam", slug: `rls-redteam-${Date.now()}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw wsErr ?? new Error("no workspace");
      workspaceId = ws.id as string;

      await admin()
        .from("workspace_members")
        .insert({ workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" });

      // Seeded through the repository's own inserts — writes stay service-role,
      // so the fixture cannot be shaped by the fence it is testing.
      const repo = await import("./repository");
      const priv = await repo.insertBase({
        workspaceId,
        name: "Private",
        slug: "private",
        visibility: "private",
        createdBy: ownerId,
      });
      const pub = await repo.insertBase({
        workspaceId,
        name: "Public",
        slug: "public",
        visibility: "public",
        createdBy: ownerId,
      });
      privateBaseId = priv.id;
      publicBaseId = pub.id;
      const folder = await repo.insertFolder({
        workspaceId,
        knowledgeBaseId: privateBaseId,
        name: "Folder",
        createdBy: ownerId,
      });
      await repo.insertEntry({
        workspaceId,
        knowledgeBaseId: privateBaseId,
        folderId: folder.id,
        title: "Entry",
        body: "secret",
        createdBy: ownerId,
        source: "user",
      });
    }, 60_000);

    afterAll(async () => {
      if (workspaceId) await admin().from("workspaces").delete().eq("id", workspaceId);
      for (const id of [ownerId, outsiderId]) {
        if (id) await admin().auth.admin.deleteUser(id);
      }
    }, 60_000);

    const rows = async (userId: string, table: string, shared = false) => {
      const { data, error } = await callerScopedClient(scopeFor(userId, shared))
        .from(table)
        .select("id")
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      return data ?? [];
    };

    it.each(["knowledge_bases", "knowledge_folders", "knowledge_entries"])(
      "%s: a NON-MEMBER sees zero rows",
      async (table) => {
        expect(await rows(outsiderId, table)).toHaveLength(0);
      }
    );

    it("knowledge_bases: the owner sees both of their own bases", async () => {
      const ids = (await rows(ownerId, "knowledge_bases")).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([privateBaseId, publicBaseId]));
    });

    it("🔒 a SHARED CREDENTIAL on the owner's id sees the public base and NOT the private one", async () => {
      const ids = (await rows(ownerId, "knowledge_bases", true)).map((r) => r.id);
      expect(ids).toContain(publicBaseId);
      expect(ids).not.toContain(privateBaseId);
    });

    it.each(["knowledge_folders", "knowledge_entries"])(
      "%s: a shared credential cannot reach a child of a private base",
      async (table) => {
        expect(await rows(ownerId, table, true)).toHaveLength(0);
      }
    );
  }
);
