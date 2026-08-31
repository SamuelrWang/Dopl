/**
 * Live smoke test for the workspace billing system. Runs the REAL
 * entitlements / webhook / chats-retention code against the live DB using
 * disposable fixtures (two throwaway auth users + one temp workspace),
 * then cleans everything up. Never touches existing user data.
 *
 * Run from repo root:  set -a; source .env.local; set +a; npx tsx scripts/smoke-billing.mts
 */
import { createClient } from "@supabase/supabase-js";
import {
  getWorkspaceEntitlements,
  assertCanCreateObject,
  EntitlementError,
  FREE_MULTI_MEMBER_OBJECT_CAP,
} from "../src/features/billing/server/entitlements";
import { processStripeEvent } from "../src/features/billing/server/webhook-handler";
import { listChats, getChat } from "../src/features/chats/server/service-reads";
import { ChatOutsideRetentionError } from "../src/features/chats/server/errors";
import type Stripe from "stripe";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("== fixtures ==");
  const stamp = Math.random().toString(36).slice(2, 8);
  const mk = async (tag: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `smoke-billing-${tag}-${stamp}@example.com`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`);
    return data.user.id;
  };
  const userA = await mk("owner");
  const userB = await mk("member");

  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .insert({
      owner_id: userA,
      name: "Smoke Billing Test",
      slug: `smoke-billing-${stamp}`,
      public_id: `smoke${stamp}`,
    })
    .select("id, slug")
    .single();
  if (wsErr || !ws) throw new Error(`workspace insert: ${wsErr?.message}`);
  const wsId = ws.id as string;

  const cleanup = async () => {
    await admin.from("workspaces").delete().eq("id", wsId);
    await admin.auth.admin.deleteUser(userA).catch(() => {});
    await admin.auth.admin.deleteUser(userB).catch(() => {});
  };

  try {
    await admin.from("workspace_members").insert([
      { workspace_id: wsId, user_id: userA, role: "owner", status: "active" },
    ]);

    console.log("== 1. solo free workspace ==");
    let ent = await getWorkspaceEntitlements(wsId);
    check("solo free: plan=free", ent.plan === "free", JSON.stringify(ent));
    check("solo free: uncapped (objectCap null)", ent.objectCap === null);
    check("solo free: full chat history? NO — window applies", ent.chatsWindowDays === 90);
    check("solo free: canCreateObjects", ent.canCreateObjects === true);
    await assertCanCreateObject(wsId); // must not throw
    check("solo free: assertCanCreateObject passes", true);

    console.log("== 2. second member joins → cap engages ==");
    await admin.from("workspace_members").insert([
      { workspace_id: wsId, user_id: userB, role: "member", status: "active" },
    ]);
    ent = await getWorkspaceEntitlements(wsId);
    // ⚠ THE LABEL IS INTERPOLATED (D14, 2026-08-30). It read `objectCap=1000`
    // against a constant that is 100 — the assertion was always right and the
    // sentence printed beside it was not, which is the worst of the two to
    // read in a smoke log.
    check(
      `2-member free: objectCap=${FREE_MULTI_MEMBER_OBJECT_CAP}`,
      ent.objectCap === FREE_MULTI_MEMBER_OBJECT_CAP
    );
    check("2-member free: memberCount=2", ent.memberCount === 2);

    // seed exactly cap-1 objects, then walk the boundary
    const rows = Array.from({ length: FREE_MULTI_MEMBER_OBJECT_CAP - 1 }, (_, i) => ({
      workspace_id: wsId,
      name: `smoke-obj-${i}`,
      created_by: userA,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("ontology_objects").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`object seed: ${error.message}`);
    }
    ent = await getWorkspaceEntitlements(wsId);
    check("at 999: objectsUsed=999", ent.objectsUsed === 999, String(ent.objectsUsed));
    check("at 999: canCreateObjects", ent.canCreateObjects === true);
    await assertCanCreateObject(wsId);
    check("at 999: assert passes", true);

    await admin.from("ontology_objects").insert({
      workspace_id: wsId,
      name: "smoke-obj-1000",
      created_by: userA,
    });
    ent = await getWorkspaceEntitlements(wsId);
    check("at 1000: canCreateObjects=false", ent.canCreateObjects === false);
    let threw = false;
    try {
      await assertCanCreateObject(wsId);
    } catch (e) {
      threw = e instanceof EntitlementError && e.code === "over_free_cap";
    }
    check("at 1000: assert throws EntitlementError(over_free_cap)", threw);

    console.log("== 3. freeze recovery: delete back under cap ==");
    await admin
      .from("ontology_objects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("workspace_id", wsId)
      .eq("name", "smoke-obj-1000");
    ent = await getWorkspaceEntitlements(wsId);
    check("soft-deleted object frees the slot", ent.canCreateObjects === true, String(ent.objectsUsed));

    console.log("== 4. webhook lifecycle: free → pro → past_due → canceled ==");
    const subId = `sub_smoke_${stamp}`;
    const custId = `cus_smoke_${stamp}`;
    const subObj = {
      id: subId,
      customer: custId,
      status: "active",
      metadata: { workspace_id: wsId },
      items: {
        data: [
          {
            quantity: 2,
            price: { id: process.env.STRIPE_PRO_SEAT_PRICE_ID ?? "price_smoke" },
          },
        ],
      },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    };
    let evtClock = Math.floor(Date.now() / 1000);
    const evt = (id: string, type: string, object: unknown): Stripe.Event =>
      ({ id, type, created: ++evtClock, data: { object } }) as unknown as Stripe.Event;

    await processStripeEvent(evt(`evt_smoke_${stamp}_1`, "customer.subscription.updated", subObj));
    ent = await getWorkspaceEntitlements(wsId);
    check("after sub.updated(active): plan=team", ent.plan === "team", JSON.stringify(ent));
    check("pro: uncapped", ent.objectCap === null);
    check("pro: full chat history", ent.chatsWindowDays === null);
    check("pro: seatCount=2", ent.seatCount === 2);

    await processStripeEvent(
      evt(`evt_smoke_${stamp}_2`, "invoice.payment_failed", {
        id: `in_smoke_${stamp}`,
        customer: custId,
        subscription: subId,
      })
    );
    ent = await getWorkspaceEntitlements(wsId);
    check("after payment_failed: status=past_due", ent.status === "past_due", ent.status);
    check("past_due keeps team entitlements", ent.plan === "team" && ent.canCreateObjects === true);

    await processStripeEvent(
      evt(`evt_smoke_${stamp}_3`, "customer.subscription.deleted", { ...subObj, status: "canceled" })
    );
    ent = await getWorkspaceEntitlements(wsId);
    check("after sub.deleted: plan=free", ent.plan === "free", JSON.stringify(ent));
    check("canceled + 2 members + 999 objects: capped again but under cap", ent.objectCap === 1000 && ent.canCreateObjects === true);

    // stale replay: an OLD `updated(active)` event arriving after deletion
    // must NOT resurrect Pro (event-ordering watermark)
    await processStripeEvent({
      id: `evt_smoke_${stamp}_stale`,
      type: "customer.subscription.updated",
      created: evtClock - 100,
      data: { object: subObj },
    } as unknown as Stripe.Event);
    ent = await getWorkspaceEntitlements(wsId);
    check("stale replayed updated(active) does NOT resurrect Pro", ent.plan === "free", ent.plan);

    console.log("== 5. chats retention window ==");
    const day = (n: number) => {
      const d = new Date(Date.now() - n * 24 * 3600 * 1000);
      return d.toISOString().slice(0, 10);
    };
    const { data: seeded, error: chatErr } = await admin
      .from("chats")
      .insert([
        { workspace_id: wsId, owner_id: userA, title: "fresh", session_date: day(0), visibility: "public" },
        { workspace_id: wsId, owner_id: userA, title: "inside-window", session_date: day(89), visibility: "public" },
        { workspace_id: wsId, owner_id: userA, title: "ancient", session_date: day(200), visibility: "public" },
      ])
      .select("id, title");
    if (chatErr) throw new Error(`chat seed: ${chatErr.message}`);
    const ancientId = seeded!.find((c) => c.title === "ancient")!.id as string;

    const ctx = {
      workspaceId: wsId,
      userId: userA,
      source: "user" as const,
      role: "owner" as const,
      apiKeyScoped: false,
    };
    let list = await listChats(ctx as never);
    check(
      "free: 2 visible, ancient hidden",
      list.chats.length === 2 && !list.chats.some((c) => c.title === "ancient"),
      `visible=${list.chats.map((c) => c.title).join(",")}`
    );
    check("free: hiddenCount=1", list.hiddenCount === 1, String(list.hiddenCount));

    let retentionThrew = false;
    let caughtName = "";
    try {
      await getChat(ctx as never, ancientId);
    } catch (e) {
      caughtName = (e as Error)?.constructor?.name ?? typeof e;
      // duck-type (constructor name) — tsx can dual-load modules, breaking instanceof
      retentionThrew =
        e instanceof ChatOutsideRetentionError ||
        caughtName === "ChatOutsideRetentionError";
    }
    check("free: getChat(ancient) throws ChatOutsideRetentionError", retentionThrew, caughtName || "no throw");

    // flip to pro → everything visible again (hide, never delete)
    await admin
      .from("workspace_billing")
      .update({ plan: "team", status: "active" })
      .eq("workspace_id", wsId);
    list = await listChats(ctx as never);
    check("pro: all 3 visible", list.chats.length === 3, String(list.chats.length));
    check("pro: hiddenCount=0", list.hiddenCount === 0);
    const detail = await getChat(ctx as never, ancientId);
    check("pro: getChat(ancient) restored", detail.title === "ancient", detail.title);

    console.log("== 6. instrumentation table writable ==");
    const { error: logErr } = await admin
      .from("mcp_tool_calls")
      .insert({ workspace_id: wsId, user_id: userA, tool: "dopl_smoke", op: "test", is_write: false });
    check("mcp_tool_calls insert ok", !logErr, logErr?.message ?? "");
  } finally {
    console.log("== cleanup ==");
    await cleanup();
    const { count } = await admin
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("id", wsId);
    console.log(`  workspace deleted: ${count === 0}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
