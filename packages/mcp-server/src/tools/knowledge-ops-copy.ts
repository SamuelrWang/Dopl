/**
 * `dopl_kb(op="copy_base")` — a knowledge base the caller can read, re-created
 * as a PRIVATE base in another tenancy, folders and entries and all. Routed from
 * the registrar in `knowledge.ts`.
 *
 * 🔒 **TWO ORDINARY, ALREADY-FENCED LEGS, AND THAT IS THE WHOLE DESIGN.** Leg 1
 * reads the source in the workspace the call is already in; leg 2 creates in the
 * target, inside its own `workspaceContext.run(...)`. Neither leg is a new authz
 * path, which is why this ticket ships no migration and no route — the full
 * argument lives in `copy-target.ts`'s header and is not restated here.
 *
 * 🔒 **THE SOURCE MUST BE THE CALLER'S OWN (R2, 2026-09-02).** Readable is not
 * owned: the copy lands PRIVATE to the copier in the target, so copying a
 * teammate's shared base would move their documents into a room they may not be
 * in. `copy-target.ts › notOwnedRefusal` is the fence, it runs BEFORE the tree
 * read so a refusal costs no loopback traffic, and it fails closed on an
 * unprovable owner.
 *
 * ── THE THREE THINGS THIS OP REFUSES TO GUESS ─────────────────────────────
 *
 * 1. ⚠ **IT REFUSES ABOVE {@link MAX_COPY_ENTRIES} AND CREATES NOTHING**, and
 *    the check runs BEFORE the first write. See that constant for the argument.
 * 2. 🔒 **THE COPY LANDS `visibility: "private"` AND ON THE WORKSPACE SHELF.**
 *    Private because that is what the op is for, and it keeps the write out of
 *    THE CONFIRM CLASS (INVARIANTS §10) by construction — the class is a base
 *    landing `public` inside a shared container, which this can never do. ⚠ And
 *    NO `shelf`/`homeScoped` is sent: a shelf is set at create and never moved
 *    (F-342), and the personal-shelf fence wants the caller's OWN default
 *    workspace, so it would refuse a container target anyway
 *    (`shelf.ts › homeShelfForbidden`). Sending it could only ever turn a good
 *    copy into a 403.
 * 3. ⚠ **A MID-COPY FAILURE IS REPORTED AS PARTIAL, NEVER AS SUCCESS, AND IS
 *    NEVER ROLLED BACK.** There is no delete over MCP (§10), so an unwind is not
 *    available to this layer — and a silent retry would leave a SECOND
 *    half-written base. What the operator needs is the id of what exists, the
 *    counts that landed, and the sentence that says re-running makes a second.
 */

import { workspaceContext } from "@dopl/client";
import type {
  DoplClient,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr } from "./narration.js";
import { ok, err, type ToolResponse } from "./respond.js";
import {
  isErr,
  resolveBaseOr,
  sharedCredentialPrivateBaseDenied,
} from "./knowledge-shared.js";
import {
  isCopyRefusal,
  notOwnedRefusal,
  resolveCopyTarget,
  sameWorkspaceRefusal,
  workspaceHandle,
  workspaceLabel,
} from "./copy-target.js";

const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";

/**
 * ⚠ THE HARD CEILING ON ONE COPY, AND IT REFUSES RATHER THAN TRUNCATING.
 *
 * This op is N+M LOOPBACK REQUESTS ON ONE TOOL CALL — one body read per entry,
 * one write per entry, plus a create per folder — so an unbounded base turns a
 * single call into a hold. **A HALF-COPIED BASE IS WORSE THAN A REFUSAL**: the
 * operator cannot tell which half landed without diffing two trees by hand, and
 * nothing on this surface can delete the remains (§10). So the size is measured
 * from the TREE, before anything is written, and an oversized base is refused
 * whole with the count and the cap both named.
 */
export const MAX_COPY_ENTRIES = 100;

/**
 * How many entry bodies are read at once. ⚠ Bounded fan, never a long serial
 * chain and never an unbounded `Promise.all`: serial makes a 100-entry base a
 * hold, and unbounded points 100 concurrent loopback requests at one process.
 */
export const COPY_READ_BATCH = 8;

/** One entry, resolved to the addressable path both trees use. */
interface CopyEntry {
  path: string;
  title: string;
  excerpt: string | null;
  body: string;
}

/** One folder, resolved to its path and carrying its own summary. */
interface CopyFolder {
  path: string;
  description: string | null;
}

/** What leg 1 answers: the whole source, or the reason it will not be copied. */
type SourceRead =
  | { kind: "read"; folders: CopyFolder[]; entries: CopyEntry[] }
  | { kind: "too-big"; total: number };

/** Where leg 2 got to. ⚠ `failure` is set ONLY once the base exists, which is
 *  what makes the difference between a refusal and a PARTIAL copy. */
interface WriteOutcome {
  base: KnowledgeBase;
  folders: number;
  entries: number;
  failure: { what: string; reason: string } | null;
}

/**
 * Folder id → its `/`-separated path. ⚠ Walks PARENTS, and stops on an id it has
 * already visited: a cycle in the source tree must not hang the copy. A folder
 * whose parent is missing from the snapshot is rooted rather than dropped —
 * losing it silently would move its entries into the base root with no notice.
 */
function folderPaths(folders: KnowledgeFolder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();
  for (const folder of folders) {
    const segments: string[] = [];
    const seen = new Set<string>();
    let cursor: KnowledgeFolder | undefined = folder;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      segments.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    paths.set(folder.id, segments.join("/"));
  }
  return paths;
}

/**
 * The folders to create, PARENTS FIRST. ⚠ `createKbFolderByPath` is mkdir -p, so
 * the leaves alone would be enough to reproduce the SHAPE — but only an explicit
 * create carries a folder's own `description`, and an implicitly-created parent
 * would land with a blank summary nobody notices is missing.
 */
function folderPlan(
  folders: KnowledgeFolder[],
  paths: Map<string, string>,
): CopyFolder[] {
  return folders
    .map((f) => ({
      path: paths.get(f.id) ?? f.name,
      description: f.description,
    }))
    .filter((f) => f.path !== "")
    .sort(
      (a, b) =>
        a.path.split("/").length - b.path.split("/").length ||
        a.path.localeCompare(b.path),
    );
}

/** Entry → its addressable path. ⚠ The TITLE is the leaf, which is the contract
 *  `knowledge-ops-write.ts › opWriteFile` states on the way back out. */
function entryPath(entry: KnowledgeEntry, paths: Map<string, string>): string {
  const parent = entry.folderId ? paths.get(entry.folderId) : undefined;
  return parent ? `${parent}/${entry.title}` : entry.title;
}

/**
 * Read every entry's BODY, in bounded batches. ⚠ `get_tree` ships entries with
 * `body: ""` (the server's `KnowledgeEntryMetaRow` skips the heavy column), so
 * the bodies are a second read per entry and there is no bulk route to fold them
 * into — which is also why {@link MAX_COPY_ENTRIES} exists.
 */
async function readBodies(
  client: DoplClient,
  baseId: string,
  entries: KnowledgeEntry[],
  paths: Map<string, string>,
): Promise<CopyEntry[]> {
  const out: CopyEntry[] = [];
  for (let i = 0; i < entries.length; i += COPY_READ_BATCH) {
    const batch = entries.slice(i, i + COPY_READ_BATCH);
    out.push(
      ...(await Promise.all(
        batch.map(async (e) => {
          const path = entryPath(e, paths);
          const full = await client.readKbFileByPath(baseId, path);
          return { path, title: e.title, excerpt: e.excerpt, body: full.body };
        }),
      )),
    );
  }
  return out;
}

/** LEG 1 — the whole source, read inside the SOURCE workspace's own scope. */
function readSource(
  client: DoplClient,
  base: KnowledgeBase,
): Promise<SourceRead> {
  return workspaceContext.run(
    base.workspaceId,
    async (): Promise<SourceRead> => {
      // ⚠ `MAX_COPY_ENTRIES + 1` so "at the cap" and "over it" are distinguishable
      // from ONE page — a read that stops AT its ceiling cannot tell an exhausted
      // base from a clipped one (§9).
      const tree = await client.getKbTree(base.id, {
        entryLimit: MAX_COPY_ENTRIES + 1,
      });
      const total = tree.entryTotal ?? tree.entries.length;
      if (total > MAX_COPY_ENTRIES) return { kind: "too-big", total };
      const paths = folderPaths(tree.folders);
      return {
        kind: "read",
        folders: folderPlan(tree.folders, paths),
        entries: await readBodies(client, base.id, tree.entries, paths),
      };
    },
  );
}

/**
 * LEG 2 — an ORDINARY create + writes, fenced by `withWorkspaceAuth` in the
 * TARGET. ⚠ A failure AFTER the base lands is CAUGHT and returned, not thrown: a
 * throw here would reach the caller as "the call failed" over a base that
 * exists.
 *
 * ⚠ **THE CREATE ITSELF IS THE OTHER CASE, AND IT IS A REFUSAL, NOT A PARTIAL**
 * (2026-09-02). It sat OUTSIDE the `try` and so threw raw — including the
 * mapped-everywhere-else 403 `WORKSPACE_KEY_PRIVATE_VISIBILITY` a shared
 * credential gets for a `private` write, which
 * `agent-ops-copy.ts` has always caught for the identical create. It is caught
 * here now and returned as `null`, which the caller renders as "nothing was
 * created" — the honest answer, since a create that failed left no tree behind.
 */
function writeCopy(
  client: DoplClient,
  targetId: string,
  source: KnowledgeBase,
  folders: CopyFolder[],
  entries: CopyEntry[],
): Promise<WriteOutcome | ToolResponse> {
  return workspaceContext.run(
    targetId,
    async (): Promise<WriteOutcome | ToolResponse> => {
      let base: KnowledgeBase;
      try {
        base = await client.createKbBase({
          name: source.name,
          description: source.description ?? undefined,
          // 🔒 PRIVATE, ALWAYS, and NO `homeScoped` — see this module's header.
          visibility: "private",
        });
      } catch (e) {
        const mapped = sharedCredentialPrivateBaseDenied(e);
        if (mapped) return mapped;
        throw e;
      }
      let madeFolders = 0;
      let madeEntries = 0;
      try {
        for (const folder of folders) {
          await client.createKbFolderByPath(
            base.id,
            folder.path,
            folder.description,
          );
          madeFolders += 1;
        }
        for (const entry of entries) {
          await client.writeKbFileByPath(base.id, entry.path, {
            body: entry.body,
            title: entry.title,
            excerpt: entry.excerpt ?? undefined,
          });
          madeEntries += 1;
        }
      } catch (e) {
        // ⚠ The counters ARE the cursor: the first unwritten row is the one that
        // failed, so the refusal can name it without a second bookkeeping field.
        const stalled =
          madeFolders < folders.length
            ? `folder ${inlineOr(folders[madeFolders].path, NO_PATH)}`
            : `entry ${inlineOr(entries[madeEntries]?.path, NO_PATH)}`;
        return {
          base,
          folders: madeFolders,
          entries: madeEntries,
          failure: {
            what: stalled,
            reason: e instanceof Error ? e.message : String(e),
          },
        };
      }
      return {
        base,
        folders: madeFolders,
        entries: madeEntries,
        failure: null,
      };
    },
  );
}

export async function opCopyBase(
  client: DoplClient,
  directory: WorkspaceDirectory,
  selfUserId: string | null,
  ref: string,
  toWorkspace: string,
): Promise<ToolResponse> {
  // ⚠ THE TARGET RESOLVES FIRST, so an unaddressable `to_workspace` costs one
  // cached directory read and not a whole tree.
  const target = await resolveCopyTarget(directory, toWorkspace);
  if (isCopyRefusal(target)) return target;

  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;

  const onto = sameWorkspaceRefusal(
    target,
    base.workspaceId,
    "knowledge base",
    `dopl_kb(op="create_base")`,
  );
  if (onto) return onto;

  // 🔒 R2 — OWNED, not merely readable, and BEFORE the tree read: a refusal must
  // not cost N loopback reads. See `copy-target.ts › notOwnedRefusal`.
  const notOwned = notOwnedRefusal(
    base.createdBy,
    selfUserId,
    "knowledge base",
    base.name,
  );
  if (notOwned) return notOwned;

  const source = await readSource(client, base);
  if (source.kind === "too-big") {
    return err(
      `Refused before writing: ${inlineOr(base.name, NO_NAME)} holds ${source.total} entries and this op copies at most ${MAX_COPY_ENTRIES}. NOTHING was created. One copy is a read AND a write per entry on a single tool call, and a base copied halfway is worse than one not copied at all — you cannot tell which half landed, and nothing on this surface can delete the remains. Split the base, or ask the user to copy it in the Dopl app.`,
    );
  }

  const written = await writeCopy(
    client,
    target.id,
    base,
    source.folders,
    source.entries,
  );
  // ⚠ A REFUSAL FROM THE CREATE ITSELF, which is not a partial copy — nothing
  // exists to finish or clean up, so it is returned verbatim rather than
  // re-framed as one.
  if ("content" in written) return written;
  const out = written;
  const handle = workspaceHandle(target);
  const where = workspaceLabel(target);
  const named = `${inlineOr(out.base.name, NO_NAME)} (slug: \`${out.base.slug}\`, id: \`${out.base.id}\`)`;

  if (out.failure) {
    return err(
      [
        `⚠ PARTIAL COPY — the new base EXISTS in ${where} and is INCOMPLETE. Nothing was rolled back, because there is no delete on this surface.`,
        `Created ${named} with ${out.folders} of ${source.folders.length} folders and ${out.entries} of ${source.entries.length} entries.`,
        `It stopped at ${out.failure.what}: ${inlineOr(out.failure.reason, "`no detail reported`")}.`,
        `⚠ Re-running op="copy_base" makes a SECOND base rather than finishing this one. Finish it with dopl_kb(op="write_file", workspace="${handle}", base="${out.base.slug}", …), or ask the user to delete it in the Dopl app and start again.`,
      ].join("\n"),
    );
  }
  return ok(
    [
      `Copied the knowledge base ${inlineOr(base.name, NO_NAME)} into ${where} as ${named}: ${out.folders} folder${out.folders === 1 ? "" : "s"} and ${out.entries} entr${out.entries === 1 ? "y" : "ies"} written.`,
      `It is PRIVATE to you there — a copy is never published into the target — and it is a STRANGER to the original: writing to one never touches the other.`,
      `Address it with \`workspace="${handle}"\`, e.g. dopl_kb(op="get_tree", base="${out.base.slug}", workspace="${handle}").`,
    ].join("\n"),
  );
}
