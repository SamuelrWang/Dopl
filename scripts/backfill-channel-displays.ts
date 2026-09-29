/**
 * ONE-OFF: stamp `metadata.display` onto existing channel messages whose display was dropped
 * before it reached the route (2026-09-28: `dopl_send_message kind="record"` never forwarded
 * `display`, and the MCP schema stripped `layout`).
 *
 * The stamp is built by the SAME code the post path runs — `DisplayInputSchema` (normalize +
 * validate) then `displayStamp(newDisplayId(), …)`, exactly `service-writes-device.ts ›
 * deviceStamps` — so a backfilled row is indistinguishable from a freshly posted one. A row that
 * already carries a display is skipped; an invalid display aborts before anything is written.
 *
 * Usage (dry run unless --apply):
 *   npx tsx scripts/backfill-channel-displays.ts --channel=<uuid> --from-seq=<n> --file=<displays.json> [--apply]
 *
 * `--file` is a JSON array of `{ name?, blocks, layout?, wait_for_input? }`; entry i maps to
 * seq `from-seq + i`. Requires Supabase service credentials in .env.local.
 */
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function main() {
  const channelId = arg("channel");
  const fromSeq = Number(arg("from-seq"));
  const file = arg("file");
  const apply = process.argv.includes("--apply");
  if (!channelId || !Number.isInteger(fromSeq) || !file) {
    console.error("Usage: --channel=<uuid> --from-seq=<n> --file=<displays.json> [--apply]");
    process.exit(1);
  }

  // Dynamic imports AFTER dotenv so module-level env reads see values.
  const { supabaseAdmin } = await import("../src/shared/supabase/admin");
  const { DisplayInputSchema, displayStamp, newDisplayId, DISPLAY_METADATA_KEY } = await import(
    "../src/features/glasses/core/screens/display"
  );

  const entries = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  // Validate EVERY entry first: an invalid one aborts the run with nothing written.
  const stamps = entries.map((e, i) => {
    const parsed = DisplayInputSchema.safeParse({ blocks: e.blocks, layout: e.layout, wait_for_input: e.wait_for_input });
    if (!parsed.success) throw new Error(`entry ${i} (${String(e.name)}): ${parsed.error.issues.map((x) => x.message).join("; ")}`);
    return displayStamp(newDisplayId(), parsed.data);
  });

  const db = supabaseAdmin();
  for (const [i, stamp] of stamps.entries()) {
    const seq = fromSeq + i;
    const { data: row, error } = await db
      .from("channel_messages")
      .select("id, seq, body, metadata")
      .eq("channel_id", channelId)
      .eq("seq", seq)
      .maybeSingle();
    if (error) throw new Error(`seq ${seq}: ${error.message}`);
    if (!row) {
      console.log(`seq ${seq}: no row — skipped`);
      continue;
    }
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (metadata[DISPLAY_METADATA_KEY]) {
      console.log(`seq ${seq}: already has a display — skipped`);
      continue;
    }
    const label = `seq ${seq} (${String(entries[i].name)}) "${String(row.body).slice(0, 40)}" → ${stamp.screen_id}`;
    if (!apply) {
      console.log(`DRY ${label}`);
      continue;
    }
    // ⚠ Guarded on the display still being absent, so a concurrent stamp is never overwritten.
    const { data: updated, error: upErr } = await db
      .from("channel_messages")
      .update({ metadata: { ...metadata, [DISPLAY_METADATA_KEY]: stamp } })
      .eq("id", row.id)
      .is(`metadata->${DISPLAY_METADATA_KEY}`, null)
      .select("id");
    if (upErr) throw new Error(`seq ${seq}: ${upErr.message}`);
    console.log(`${updated && updated.length === 1 ? "OK " : "RACE (skipped)"} ${label}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
