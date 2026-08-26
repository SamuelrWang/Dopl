/**
 * 🔒 EVERY TABLE THE WEB CLIENT SUBSCRIBES TO MUST ADMIT A GUEST (2026-08-26).
 *
 * THE BUG THIS PINS, in one sentence: the guest web lane's live loop
 * (`GuestChannel` → `StandaloneChannelSurface` → `channel-surface-data.ts` →
 * `channels-v2/live.ts` → `client/realtime.ts` → `shared-channel-registry.ts` →
 * `getSupabaseBrowser()`) is a USER-client `postgres_changes` subscription, so
 * RLS applies — unlike every guest-reachable HTTP read, which runs service-role
 * and bypasses RLS entirely. All five channel-family SELECT policies gated on
 * `is_current_workspace_member(workspace_id,'viewer')` and a guest ranks -1, so
 * the subscription reported SUBSCRIBED and delivered ZERO events. A guest never
 * saw a reply without reloading the page.
 *
 * ⚠ IT IS A REGRESSION THE guest-role WAVE INTRODUCED. Before M0 a bound claimer
 * landed at `admin`, which cleared the viewer floor.
 *
 * ⚠ AND `…/await` WAS NOT THE FALLBACK. F-324 claimed the long-poll covered it;
 * it has NO browser caller (only `packages/dopl-client` and the desktop).
 *
 * WHY THIS TEST IS SHAPED AROUND THE SUBSCRIPTION LIST RATHER THAN AROUND THE
 * FOUR TABLES: the durable rule is not "these four have a guest arm", it is
 * **"a table this client subscribes to has a guest arm"**. Adding a fifth entry
 * to `CHANNEL_TABLES` / `PRESENCE_TABLES` without one re-creates the exact
 * failure, and — §7's first bullet — that failure HAS NO ERROR SHAPE. This is
 * the same both-directions pin `dopl-desktop-app/test/ui-sync-tables.test.mjs`
 * holds for the publication.
 *
 * ⚠ THE MIGRATION FILE IS THE CLAIM; THE DATABASE IS THE FACT (§12). This test
 * reads the tree. The applied state was verified by reading `pg_policies` back
 * and by a behavioural probe in a rolled-back transaction — recorded in
 * INVARIANTS §12.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  CHANNEL_TABLES,
  CONSENT_TABLES,
  PRESENCE_TABLES,
} from "../constants";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Every migration, oldest first — the order the database replays them in. */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/**
 * The LAST `CREATE POLICY` for `<table>` on SELECT, as raw SQL. Last wins, for
 * the same reason `check-role-drift.ts` reads the last `CREATE OR REPLACE`:
 * an earlier definition is history, not state.
 */
function latestSelectPolicy(table: string): string | null {
  for (const file of [...FILES].reverse()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const re = new RegExp(
      `CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+(?:public\\.)?${table}\\b[\\s\\S]*?;`,
      "i"
    );
    const m = re.exec(sql);
    if (m && /FOR\s+SELECT/i.test(m[0])) return m[0];
  }
  return null;
}

/** The tables the WEB client opens a postgres_changes binding on. */
const SUBSCRIBED = [...CHANNEL_TABLES, ...PRESENCE_TABLES];

describe("guest realtime — the subscribed tables admit a guest", () => {
  it("knows which tables the client subscribes to", () => {
    // Measured 2026-08-26. A change here is a deliberate act and drags the rest
    // of this file with it.
    expect(SUBSCRIBED).toEqual([
      "channels",
      "channel_members",
      "channel_messages",
      "agent_presence",
    ]);
  });

  it.each(SUBSCRIBED)("%s's SELECT policy has a guest arm", (table) => {
    const policy = latestSelectPolicy(table);
    expect(policy, `no CREATE POLICY … ON ${table} FOR SELECT found`).not.toBeNull();
    expect(policy).toMatch(/is_current_workspace_member\([^)]*'guest'\)/);
  });

  it.each(CHANNEL_TABLES)(
    "%s KEEPS its viewer arm — the guest arm is an addition, never a replacement",
    (table) => {
      // Without this half, a "simplification" that collapsed both arms into the
      // guest one would pass the test above while widening every member's reach
      // to channels they are not in.
      expect(latestSelectPolicy(table)).toMatch(
        /is_current_workspace_member\([^)]*'viewer'\)/
      );
    }
  );

  it.each(CHANNEL_TABLES)(
    "%s's guest arm requires REAL channel membership, not visibility='public'",
    (table) => {
      // 🔒 The one asymmetry, and it mirrors `service-shared.ts ›
      // mayReadPublicChannels`. A guest has no tenancy, so "any workspace member
      // can see and join" is not a statement about them. If the guest arm ever
      // inherits the public disjunct, a public channel in the container becomes
      // readable by a guest who was never added to it.
      const policy = latestSelectPolicy(table) ?? "";
      const guestArm = policy.slice(policy.indexOf("'guest'"));
      expect(guestArm).toMatch(/is_channel_member/);
      expect(guestArm).not.toMatch(/visibility\s*=\s*'public'/);
    }
  );

  it("agent_presence is deliberately NOT arm-shaped — one literal, no subquery", () => {
    // ⚠ COST, and it is §7's own rule. `agent_presence` is the highest-churn
    // published table (a heartbeat per listener per ~30s) and its SELECT policy
    // is re-evaluated per subscriber per write; an OR-arm would roughly double
    // that. Swapping the literal costs zero. The rule it states — "an ACTIVE
    // member of a workspace may see who is around in it" — is what the policy
    // always meant; `viewer` was the floor only because it used to be the floor
    // role, and `POST /api/channels/presence` is ALREADY guest-floored, so a
    // feed a guest may write and never read was incoherent.
    const policy = latestSelectPolicy("agent_presence") ?? "";
    expect(policy).not.toMatch(/EXISTS/i);
    expect(policy).not.toMatch(/'viewer'/);
  });

  it("channel_consent_requests is NOT in the guest's subscription set", () => {
    // The guest surface does not mount `useConsentInbox` at all
    // (`channel-surface-data.ts`, `selfManagement: false`), so this table needs
    // no guest arm — and it must not get one: an outbound consent row is the
    // OPERATOR's own draft queue.
    expect(CONSENT_TABLES).toEqual(["channel_consent_requests"]);
    expect(SUBSCRIBED).not.toContain("channel_consent_requests");
    const policy = latestSelectPolicy("channel_consent_requests") ?? "";
    expect(policy).not.toMatch(/'guest'/);
  });
});
