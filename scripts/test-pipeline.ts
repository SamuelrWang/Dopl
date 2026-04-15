/**
 * Test script to verify the ingestion pipeline works end-to-end.
 * Ingests a URL, streams progress events, and checks the final entry.
 * Run with: npx tsx scripts/test-pipeline.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const BASE_URL = process.env.DOPL_BASE_URL || "https://www.usedopl.com";
const ADMIN_SECRET = process.env.ADMIN_SECRET!;

// A small, fast-to-ingest GitHub repo
const TEST_URL = "https://github.com/anthropics/anthropic-cookbook";

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

async function main() {
  console.log("\n🔬 PIPELINE TEST\n");

  // ── Step 1: Trigger ingestion ──
  console.log("── Step 1: Trigger ingestion ──");

  const ingestRes = await fetch(`${BASE_URL}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify({ url: TEST_URL }),
  });

  if (!ingestRes.ok) {
    const body = await ingestRes.text();
    fail("POST /api/ingest", `${ingestRes.status}: ${body}`);
    return;
  }

  const { entry_id, stream_url } = await ingestRes.json();
  if (entry_id) ok(`Ingestion started: ${entry_id}`);
  else { fail("No entry_id returned"); return; }

  if (stream_url) ok(`Stream URL provided: ${stream_url}`);
  else fail("No stream_url returned");

  // ── Step 2: Stream progress events ──
  console.log("\n── Step 2: Stream progress events ──");

  const events: Array<{ type: string; message: string; step?: string }> = [];
  let completed = false;
  let errored = false;

  try {
    const streamRes = await fetch(`${BASE_URL}${stream_url}`);
    if (!streamRes.ok || !streamRes.body) {
      fail("SSE stream connection", `${streamRes.status}`);
      return;
    }

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const timeout = setTimeout(() => {
      console.log("  ⏰ Timed out after 5 minutes");
      reader.cancel();
    }, 5 * 60 * 1000);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          events.push(event);

          // Print progress
          const icon = event.type === "error" ? "💥" :
                       event.type === "complete" ? "🎉" :
                       event.type === "step_start" ? "▶" :
                       event.type === "step_complete" ? "✓" :
                       event.type === "detail" ? "  ·" : "ℹ";
          console.log(`  ${icon} [${event.type}] ${event.message}`);

          if (event.type === "complete") { completed = true; reader.cancel(); break; }
          if (event.type === "error") { errored = true; reader.cancel(); break; }
        } catch { /* skip non-JSON lines */ }
      }

      if (completed || errored) break;
    }

    clearTimeout(timeout);
  } catch (err) {
    // reader.cancel() throws, that's fine
  }

  // ── Step 3: Validate progress events ──
  console.log("\n── Step 3: Validate progress events ──");

  if (completed) ok("Pipeline completed successfully");
  else if (errored) fail("Pipeline errored", events.find(e => e.type === "error")?.message);
  else fail("Pipeline did not complete");

  const eventTypes = events.map(e => e.type);
  if (eventTypes.includes("info")) ok("Received 'info' event");
  else fail("Missing 'info' event");

  if (eventTypes.includes("step_start")) ok("Received 'step_start' events");
  else fail("Missing 'step_start' events");

  if (eventTypes.includes("step_complete")) ok("Received 'step_complete' events");
  else fail("Missing 'step_complete' events");

  if (eventTypes.includes("detail")) ok("Received 'detail' events");
  else fail("Missing 'detail' events");

  // Check expected pipeline steps appeared
  const steps = events.filter(e => e.step).map(e => e.step!);
  const uniqueSteps = [...new Set(steps)];

  const expectedSteps = [
    "text_extraction",
    "content_classification",
    "manifest_generation",
    "readme_generation",
    "agents_md_generation",
    "tag_generation",
    "embedding",
  ];

  for (const step of expectedSteps) {
    if (uniqueSteps.includes(step)) ok(`Step '${step}' executed`);
    else fail(`Step '${step}' missing from events`);
  }

  // ── Step 4: Verify entry in DB via API ──
  console.log("\n── Step 4: Verify final entry ──");

  // Give a moment for final DB writes
  await new Promise(r => setTimeout(r, 1000));

  const entryRes = await fetch(`${BASE_URL}/api/entries/${entry_id}`, {
    headers: { "Authorization": `Bearer ${ADMIN_SECRET}` },
  });

  if (!entryRes.ok) {
    fail("GET /api/entries/:id", `${entryRes.status}`);
  } else {
    const entry = await entryRes.json();

    if (entry.status === "complete") ok("Entry status is 'complete'");
    else fail("Entry status", `expected 'complete', got '${entry.status}'`);

    if (entry.title && entry.title !== "Untitled Setup") ok(`Title: "${entry.title}"`);
    else fail("Entry title missing or default");

    if (entry.readme && entry.readme.length > 100) ok(`README generated (${Math.round(entry.readme.length / 1000)}K chars)`);
    else fail("README missing or too short");

    if (entry.agents_md && entry.agents_md.length > 100) ok(`agents.md generated (${Math.round(entry.agents_md.length / 1000)}K chars)`);
    else fail("agents.md missing or too short");

    if (entry.manifest && typeof entry.manifest === "object") ok("Manifest generated");
    else fail("Manifest missing");

    if (entry.use_case) ok(`Use case: ${entry.use_case}`);
    else fail("Use case missing");

    if (entry.complexity) ok(`Complexity: ${entry.complexity}`);
    else fail("Complexity missing");
  }

  // Check tags
  const tagsRes = await fetch(`${BASE_URL}/api/tags`, {
    headers: { "Authorization": `Bearer ${ADMIN_SECRET}` },
  });
  if (tagsRes.ok) {
    const tags = await tagsRes.json();
    // Just check tags endpoint works
    ok(`Tags endpoint works (${Array.isArray(tags) ? tags.length : '?'} total tags)`);
  }

  // ── Summary ──
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);

  // ── Cleanup: delete the test entry ──
  console.log("🧹 Cleaning up test entry...");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await admin.from("entries").delete().eq("id", entry_id);
  console.log("Done.\n");
}

main().catch(console.error);
