/**
 * `dopl_kb` op="history" and op="restore" — one ENTRY's changelog, one revision read, and the
 * write-back. The app's Changelog panel reads the same route.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW: it prints the snapshot a restore would write and
 * the current Version to pass, so the old/new summary is in hand BEFORE the write.
 * ⚠ `restore` REQUIRES `expected_version` and checks it twice — here, before the call, and in
 * the route (`X-Updated-At`, atomic) — so a restore over a newer edit is refused, never a clobber.
 */

import type { ContentRevision, DoplClient, KnowledgeEntry } from "@dopl/client";
import { inlineOr, NO_NAME, NO_PATH } from "./narration";
import { ok, err, type ToolResponse } from "./respond";
import { agentWriteDenied, entryNotFound, resolveBaseOr } from "./knowledge-shared";
import { isErr } from "./channel-shared";
import { fenceBody } from "./untrusted-fence";
import {
  foreignRevision,
  HISTORY_OP,
  HISTORY_PAGE_DEFAULT,
  pageTail,
  restoreRefusal,
  revisionNotFound,
  revisionRow,
  staleBeforeRestore,
} from "./revision-render";
import { refusal } from "./tool-errors";

/** A revision read walks at most this many server pages (200 rows each) before it gives up. */
const FIND_PAGES_MAX = 10;
const FIND_PAGE_SIZE = 200;

interface Located {
  entry: KnowledgeEntry;
  chars: number;
}

/** The entry at base+path, with its size — the outline read, so no body crosses the wire. */
async function locate(
  client: DoplClient,
  baseRef: string,
  path: string,
): Promise<Located | ToolResponse> {
  const base = await resolveBaseOr(client, baseRef);
  if (isErr(base)) return base;
  try {
    const read = await client.readKbFilePart(base.id, path, { outline: true });
    return { entry: read.entry, chars: read.outline?.totalChars ?? read.entry.body.length };
  } catch (e) {
    const missing = entryNotFound(e, path, baseRef);
    if (missing) return missing;
    throw e;
  }
}

async function findRevision(
  client: DoplClient,
  entryId: string,
  revisionId: string,
): Promise<ContentRevision | null> {
  let cursor: string | undefined;
  for (let i = 0; i < FIND_PAGES_MAX; i++) {
    const page = await client.listKbEntryRevisions(entryId, { cursor, limit: FIND_PAGE_SIZE });
    const hit = page.revisions.find((r) => r.id === revisionId);
    if (hit) return hit;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

export async function opHistory(
  client: DoplClient,
  baseRef: string,
  path: string,
  callerUserId: string | null,
  opts: { revision?: string; limit?: number; cursor?: string },
): Promise<ToolResponse> {
  const found = await locate(client, baseRef, path);
  if (isErr(found)) return found;
  const { entry, chars } = found;
  const current = `Current: Version \`${entry.updatedAt}\` · entry id \`${entry.id}\` · ${chars} chars.`;

  if (opts.revision !== undefined) {
    const rev = await findRevision(client, entry.id, opts.revision);
    if (!rev) {
      return err(
        refusal(
          revisionNotFound(HISTORY_OP),
          `${inlineOr(opts.revision, "`(empty)`")} is not in this entry's last ${FIND_PAGES_MAX * FIND_PAGE_SIZE} revisions.`,
        ),
      );
    }
    const body = rev.payload.body ?? "";
    const title = rev.payload.title ? inlineOr(rev.payload.title, NO_NAME) : "`(title unchanged)`";
    return ok(
      [
        `# Revision \`${rev.id}\` of ${inlineOr(entry.title, NO_NAME)}`,
        revisionRow(rev, callerUserId),
        current,
        `Restoring writes THIS snapshot (title ${title}, ${body.length} chars) over the current entry (${chars} chars) as a NEW revision; nothing is deleted. To do it: op="restore" revision="${rev.id}" expected_version="${entry.updatedAt}".`,
        "",
        "---",
        "",
        ...(foreignRevision(rev, callerUserId)
          ? fenceBody(body, "knowledge revision by another member")
          : [body]),
      ].join("\n"),
    );
  }

  const page = await client.listKbEntryRevisions(entry.id, {
    cursor: opts.cursor,
    limit: opts.limit ?? HISTORY_PAGE_DEFAULT,
  });
  const lines = [
    `# History: ${inlineOr(entry.title, NO_NAME)} (path ${inlineOr(path, NO_PATH)})`,
    current,
    "",
  ];
  if (page.revisions.length === 0) lines.push("_No revisions recorded._");
  for (const rev of page.revisions) {
    const size = typeof rev.payload.body === "string" ? ` · ${rev.payload.body.length} chars` : "";
    lines.push(revisionRow(rev, callerUserId, size));
  }
  lines.push(
    "",
    pageTail(page.nextCursor, "entry_cursor"),
    `Preview one with op="history" revision="<id>"; restore with op="restore" revision="<id>" expected_version="${entry.updatedAt}".`,
  );
  return ok(lines.join("\n"));
}

export async function opRestore(
  client: DoplClient,
  baseRef: string,
  path: string,
  revisionId: string,
  expectedVersion: string,
): Promise<ToolResponse> {
  const found = await locate(client, baseRef, path);
  if (isErr(found)) return found;
  const { entry, chars } = found;
  if (entry.updatedAt !== expectedVersion) {
    return staleBeforeRestore(HISTORY_OP, entry.updatedAt, expectedVersion);
  }
  let restored: KnowledgeEntry;
  try {
    restored = await client.restoreKbEntryRevision(entry.id, revisionId, expectedVersion);
  } catch (e) {
    const mapped = restoreRefusal(e, HISTORY_OP, HISTORY_OP) ?? agentWriteDenied(e);
    if (mapped) return mapped;
    throw e;
  }
  return ok(
    [
      `Restored ${inlineOr(restored.title, NO_NAME)} to revision \`${revisionId}\` — written as a NEW revision; the one you restored from, and the state you replaced, are both still in op="history".`,
      `Version \`${expectedVersion}\` → \`${restored.updatedAt}\` · ${chars} → ${restored.body.length} chars · entry id \`${restored.id}\`.`,
    ].join("\n"),
  );
}
