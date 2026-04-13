/**
 * Test script to verify RLS policies and cascade behavior.
 * Run with: npx tsx scripts/test-rls.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client (bypasses RLS)
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
// Anon client (subject to RLS)
const anon = createClient(SUPABASE_URL, ANON_KEY);

let passed = 0;
let failed = 0;

function ok(test: string) {
  passed++;
  console.log(`  ✅ ${test}`);
}
function fail(test: string, detail?: string) {
  failed++;
  console.log(`  ❌ ${test}${detail ? ` — ${detail}` : ""}`);
}

async function createTestUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create user ${email}: ${error.message}`);
  return data.user;
}

async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
  return { client, session: data.session!, user: data.user! };
}

async function deleteTestUser(userId: string) {
  await admin.auth.admin.deleteUser(userId);
}

async function main() {
  console.log("\n🔬 RLS & CASCADE TEST SUITE\n");
  console.log("Using Supabase URL:", SUPABASE_URL);

  const testEmail1 = `test-rls-user1-${Date.now()}@test.local`;
  const testEmail2 = `test-rls-user2-${Date.now()}@test.local`;
  const testPassword = "TestPassword123!";

  let user1Id: string | null = null;
  let user2Id: string | null = null;

  try {
    // ── Setup: Create two test users ──
    console.log("\n📦 Setting up test users...");
    const user1 = await createTestUser(testEmail1, testPassword);
    const user2 = await createTestUser(testEmail2, testPassword);
    user1Id = user1.id;
    user2Id = user2.id;
    console.log(`  User 1: ${testEmail1} (${user1Id})`);
    console.log(`  User 2: ${testEmail2} (${user2Id})`);

    // Sign in both users
    const s1 = await signIn(testEmail1, testPassword);
    const s2 = await signIn(testEmail2, testPassword);

    // ── Test 1: Profile RLS ──
    console.log("\n── Test 1: Profile RLS ──");

    // User 1 can see own profile
    const { data: ownProfile } = await s1.client.from("profiles").select("*").eq("id", user1Id);
    if (ownProfile && ownProfile.length === 1) ok("User 1 can read own profile");
    else fail("User 1 can read own profile", `got ${ownProfile?.length} rows`);

    // User 1 cannot see User 2's profile
    const { data: otherProfile } = await s1.client.from("profiles").select("*").eq("id", user2Id);
    if (!otherProfile || otherProfile.length === 0) ok("User 1 cannot read User 2's profile");
    else fail("User 1 cannot read User 2's profile", `got ${otherProfile?.length} rows`);

    // User 1 can update own profile
    const { error: updateErr } = await s1.client
      .from("profiles")
      .update({ display_name: "Test User 1 Updated" })
      .eq("id", user1Id);
    if (!updateErr) ok("User 1 can update own profile");
    else fail("User 1 can update own profile", updateErr.message);

    // User 1 cannot update User 2's profile
    const { data: updateOther, error: updateOtherErr } = await s1.client
      .from("profiles")
      .update({ display_name: "Hacked" })
      .eq("id", user2Id)
      .select();
    if (!updateOther || updateOther.length === 0) ok("User 1 cannot update User 2's profile");
    else fail("User 1 cannot update User 2's profile", `updated ${updateOther.length} rows`);

    // ── Test 2: API Keys RLS ──
    console.log("\n── Test 2: API Keys RLS ──");

    // Create an API key for user 1 via admin (simulating app behavior)
    const keyHash1 = `test-hash-${Date.now()}-1`;
    const { error: keyErr1 } = await admin.from("api_keys").insert({
      key_hash: keyHash1,
      key_prefix: "sk-sie-test1",
      name: "Test Key 1",
      user_id: user1Id,
    });
    if (keyErr1) fail("Admin create key for user 1", keyErr1.message);

    const keyHash2 = `test-hash-${Date.now()}-2`;
    await admin.from("api_keys").insert({
      key_hash: keyHash2,
      key_prefix: "sk-sie-test2",
      name: "Test Key 2",
      user_id: user2Id,
    });

    // User 1 can see own keys
    const { data: ownKeys } = await s1.client.from("api_keys").select("*");
    if (ownKeys && ownKeys.length >= 1 && ownKeys.every((k) => k.user_id === user1Id))
      ok("User 1 can only see own API keys");
    else fail("User 1 can only see own API keys", `got ${ownKeys?.length} keys`);

    // User 1 cannot see user 2's keys
    const { data: otherKeys } = await s1.client.from("api_keys").select("*").eq("user_id", user2Id);
    if (!otherKeys || otherKeys.length === 0) ok("User 1 cannot see User 2's API keys");
    else fail("User 1 cannot see User 2's API keys", `got ${otherKeys?.length} keys`);

    // ── Test 3: Canvas Panels RLS ──
    console.log("\n── Test 3: Canvas Panels RLS ──");

    // Create a test entry via admin
    const { data: testEntry } = await admin
      .from("entries")
      .insert({
        source_url: "https://test.example/rls-test",
        title: "RLS Test Entry",
        status: "complete",
      })
      .select()
      .single();

    if (!testEntry) {
      fail("Create test entry", "could not create entry");
    } else {
      // Add canvas panel for user 1
      const { error: cpErr } = await admin.from("canvas_panels").insert({
        user_id: user1Id,
        entry_id: testEntry.id,
        title: "User 1 Panel",
      });
      if (cpErr) fail("Create canvas panel for user 1", cpErr.message);

      // Add canvas panel for user 2
      await admin.from("canvas_panels").insert({
        user_id: user2Id,
        entry_id: testEntry.id,
        title: "User 2 Panel",
      });

      // User 1 can see own canvas panels only
      const { data: ownPanels } = await s1.client.from("canvas_panels").select("*");
      if (ownPanels && ownPanels.length === 1 && ownPanels[0].user_id === user1Id)
        ok("User 1 can only see own canvas panels");
      else fail("User 1 can only see own canvas panels", `got ${ownPanels?.length} panels`);

      // User 2 can see own canvas panels only
      const { data: u2Panels } = await s2.client.from("canvas_panels").select("*");
      if (u2Panels && u2Panels.length === 1 && u2Panels[0].user_id === user2Id)
        ok("User 2 can only see own canvas panels");
      else fail("User 2 can only see own canvas panels", `got ${u2Panels?.length} panels`);
    }

    // ── Test 4: Clusters RLS ──
    console.log("\n── Test 4: Clusters RLS ──");

    // Create a global cluster (user_id = NULL)
    const { data: globalCluster } = await admin
      .from("clusters")
      .insert({ slug: `global-test-${Date.now()}`, name: "Global Test Cluster" })
      .select()
      .single();

    // Create a user-scoped cluster for user 1
    const { data: u1Cluster } = await admin
      .from("clusters")
      .insert({ slug: `user1-test-${Date.now()}`, name: "User 1 Cluster", user_id: user1Id })
      .select()
      .single();

    // Create a user-scoped cluster for user 2
    const { data: u2Cluster } = await admin
      .from("clusters")
      .insert({ slug: `user2-test-${Date.now()}`, name: "User 2 Cluster", user_id: user2Id })
      .select()
      .single();

    // User 1 should see global + own cluster, NOT user 2's cluster
    const { data: u1Clusters } = await s1.client.from("clusters").select("*");
    const u1Ids = new Set(u1Clusters?.map((c) => c.id));
    if (globalCluster && u1Ids.has(globalCluster.id)) ok("User 1 can see global clusters");
    else fail("User 1 can see global clusters");
    if (u1Cluster && u1Ids.has(u1Cluster.id)) ok("User 1 can see own clusters");
    else fail("User 1 can see own clusters");
    if (u2Cluster && !u1Ids.has(u2Cluster.id)) ok("User 1 cannot see User 2's clusters");
    else fail("User 1 cannot see User 2's clusters");

    // ── Test 5: Entries are readable by all authenticated users ──
    console.log("\n── Test 5: Shared tables (entries, sources, chunks, tags) ──");

    const { data: u1Entries } = await s1.client.from("entries").select("id").limit(1);
    if (u1Entries && u1Entries.length > 0) ok("User 1 can read entries");
    else fail("User 1 can read entries", "no entries found (may be empty DB)");

    const { data: u2Entries } = await s2.client.from("entries").select("id").limit(1);
    if (u2Entries && u2Entries.length > 0) ok("User 2 can read entries");
    else fail("User 2 can read entries", "no entries found (may be empty DB)");

    // Users should NOT be able to insert entries (service role only)
    const { error: insertEntryErr } = await s1.client.from("entries").insert({
      source_url: "https://hacker.example/bad",
      title: "Should Not Work",
    });
    if (insertEntryErr) ok("User 1 cannot insert entries (blocked by RLS)");
    else fail("User 1 cannot insert entries (blocked by RLS)", "insert succeeded!");

    // Users should NOT be able to delete entries
    if (testEntry) {
      const { data: delResult } = await s1.client
        .from("entries")
        .delete()
        .eq("id", testEntry.id)
        .select();
      if (!delResult || delResult.length === 0) ok("User 1 cannot delete entries (blocked by RLS)");
      else fail("User 1 cannot delete entries (blocked by RLS)", "delete succeeded!");
    }

    // ── Test 6: Anon (unauthenticated) access blocked ──
    console.log("\n── Test 6: Unauthenticated access ──");

    const { data: anonEntries } = await anon.from("entries").select("id").limit(1);
    if (!anonEntries || anonEntries.length === 0)
      ok("Unauthenticated client cannot read entries");
    else fail("Unauthenticated client cannot read entries", `got ${anonEntries.length} rows`);

    const { data: anonProfiles } = await anon.from("profiles").select("id").limit(1);
    if (!anonProfiles || anonProfiles.length === 0)
      ok("Unauthenticated client cannot read profiles");
    else fail("Unauthenticated client cannot read profiles", `got ${anonProfiles.length} rows`);

    // ── Test 7: Cascade behavior on user deletion ──
    console.log("\n── Test 7: Cascade on user deletion ──");

    // Check user 1's data exists before deletion
    const { data: preProfile } = await admin.from("profiles").select("id").eq("id", user1Id);
    const { data: preKeys } = await admin.from("api_keys").select("id").eq("user_id", user1Id);
    const { data: prePanels } = await admin.from("canvas_panels").select("id").eq("user_id", user1Id);
    const { data: preClusters } = await admin.from("clusters").select("id").eq("user_id", user1Id);

    console.log(`  Pre-delete: ${preProfile?.length} profiles, ${preKeys?.length} keys, ${prePanels?.length} panels, ${preClusters?.length} clusters`);

    // Set ingested_by on test entry to user 1
    if (testEntry) {
      await admin.from("entries").update({ ingested_by: user1Id }).eq("id", testEntry.id);
    }

    // Delete user 1
    await deleteTestUser(user1Id);
    console.log("  Deleted user 1...");

    // Verify cascade: profile deleted
    const { data: postProfile } = await admin.from("profiles").select("id").eq("id", user1Id);
    if (!postProfile || postProfile.length === 0) ok("Profile deleted on user deletion");
    else fail("Profile deleted on user deletion", `${postProfile.length} rows remain`);

    // Verify cascade: API keys deleted
    const { data: postKeys } = await admin.from("api_keys").select("id").eq("user_id", user1Id);
    if (!postKeys || postKeys.length === 0) ok("API keys deleted on user deletion");
    else fail("API keys deleted on user deletion", `${postKeys.length} rows remain`);

    // Verify cascade: canvas panels deleted
    const { data: postPanels } = await admin.from("canvas_panels").select("id").eq("user_id", user1Id);
    if (!postPanels || postPanels.length === 0) ok("Canvas panels deleted on user deletion");
    else fail("Canvas panels deleted on user deletion", `${postPanels.length} rows remain`);

    // Verify cascade: user clusters deleted
    const { data: postClusters } = await admin.from("clusters").select("id").eq("user_id", user1Id);
    if (!postClusters || postClusters.length === 0) ok("User clusters deleted on user deletion");
    else fail("User clusters deleted on user deletion", `${postClusters.length} rows remain`);

    // Verify: entries preserved (ingested_by set to NULL)
    if (testEntry) {
      const { data: postEntry } = await admin.from("entries").select("id, ingested_by").eq("id", testEntry.id).single();
      if (postEntry && postEntry.ingested_by === null) ok("Entry preserved with ingested_by = NULL");
      else if (postEntry) fail("Entry ingested_by should be NULL", `got ${postEntry.ingested_by}`);
      else fail("Entry should still exist after user deletion");
    }

    // Verify: global cluster still exists
    if (globalCluster) {
      const { data: postGlobal } = await admin.from("clusters").select("id").eq("id", globalCluster.id).single();
      if (postGlobal) ok("Global cluster preserved after user deletion");
      else fail("Global cluster preserved after user deletion");
    }

    user1Id = null; // Already deleted

    // ── Summary ──
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  ${passed} passed, ${failed} failed`);
    console.log(`${"═".repeat(50)}\n`);
  } catch (err) {
    console.error("\n💥 Test error:", err);
  } finally {
    // Cleanup
    console.log("🧹 Cleaning up test data...");
    if (user1Id) await deleteTestUser(user1Id).catch(() => {});
    if (user2Id) await deleteTestUser(user2Id).catch(() => {});

    // Clean up test entries and clusters created by admin
    await admin.from("entries").delete().eq("source_url", "https://test.example/rls-test");
    await admin.from("clusters").delete().like("slug", "global-test-%");
    await admin.from("clusters").delete().like("slug", "user1-test-%");
    await admin.from("clusters").delete().like("slug", "user2-test-%");

    console.log("Done.\n");
  }
}

main();
