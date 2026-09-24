/**
 * THE LEGACY SET DOES NOT MOVE (DMP-013 B3). Every text a legacy connection serves — tools/list,
 * the instructions, both doctrine resources, and every manifest binding's legacy call in three arg
 * variants (`surface-sweep.ts`) — hashed and pinned. `callRef` re-spells these for a granular
 * connection; on a legacy one they must stay byte for byte what they were.
 *
 * A deliberate legacy change re-records: `LEGACY_SURFACE_RECORD=1 npx vitest run legacy-surface`.
 * `LEGACY_SURFACE_DUMP=<dir>` writes each text beside its hash, to diff two runs.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildInstructions } from "./instructions.js";
import { DOCTRINE_URI } from "./tools/channel-doctrine.js";
import { KNOWLEDGE_DOCTRINE_URI } from "./tools/knowledge-doctrine.js";
import { boot, normalize, sweep, WS } from "./surface-sweep.js";

const SNAPSHOT = path.join(import.meta.dirname, "legacy-surface.snapshot.json");
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function legacySurface(): Promise<Record<string, string>> {
  const b = await boot("legacy");
  const texts: Record<string, string> = {
    "tools/list": JSON.stringify((await b.client.listTools()).tools, null, 1),
    "instructions:booted": b.client.getInstructions() ?? "",
    "instructions:anonymous": buildInstructions([WS]),
    "instructions:desktop": buildInstructions([], {
      desktopRun: true,
      identity: { userId: "u-1", operatorHandle: "sam", boundChannelId: "c-1", liveAgents: ["abc123"] },
    }),
  };
  for (const uri of [DOCTRINE_URI, KNOWLEDGE_DOCTRINE_URI]) {
    const { contents } = await b.client.readResource({ uri });
    texts[`resource:${uri}`] = contents.map((c) => ("text" in c ? c.text : "")).join("\n");
  }
  for (const c of await sweep()) texts[`call:${c.label}`] = `${c.legacy.isError}\n${c.legacy.text}`;
  return Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, normalize(v)]));
}

describe("the legacy surface", () => {
  it("is byte-identical to its snapshot", async () => {
    const texts = await legacySurface();
    const hashes = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, hash(v)]));
    const dump = process.env.LEGACY_SURFACE_DUMP;
    if (dump) {
      mkdirSync(dump, { recursive: true });
      writeFileSync(path.join(dump, "legacy-surface.json"), JSON.stringify(texts, null, 1));
    }
    if (process.env.LEGACY_SURFACE_RECORD) writeFileSync(SNAPSHOT, `${JSON.stringify(hashes, null, 1)}\n`);
    expect(hashes).toEqual(JSON.parse(readFileSync(SNAPSHOT, "utf8")));
  }, 120_000);
});
