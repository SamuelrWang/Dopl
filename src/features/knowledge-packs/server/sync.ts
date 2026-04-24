import { Octokit } from "@octokit/rest";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Knowledge-pack sync engine.
 *
 * The repo is the source of truth. This module pulls the latest tree from
 * a pack's GitHub repo, parses each .md file's YAML frontmatter, and
 * upserts the result into knowledge_pack_files. It does not delete files
 * automatically — a follow-up pass reconciles deletions by comparing the
 * upserted path set against what's already in the DB for that pack.
 *
 * Two callers:
 *   1. POST /api/knowledge/packs/[id]/sync — webhook from the pack's own
 *      GitHub Action, fired on push to main. Verified via HMAC.
 *   2. Scheduled task — nightly fallback that hits the same endpoint.
 */

// Prefer a pack-scoped token so the narrow read-only PAT used here doesn't
// collide with the broader GITHUB_TOKEN the ingestion pipeline relies on.
// Fall back to GITHUB_TOKEN for backwards compatibility / single-token setups.
const GH_TOKEN =
  process.env.KNOWLEDGE_PACK_GITHUB_TOKEN || process.env.GITHUB_TOKEN || undefined;

function octokit(): Octokit {
  return new Octokit({ auth: GH_TOKEN });
}

/**
 * Parse YAML frontmatter from the head of a markdown file. Supports the
 * canonical `---\n...\n---\n` envelope with simple `key: value` pairs and
 * inline `[a, b, c]` arrays. Anything more complex (nested maps, multi-line
 * scalars) falls through to the raw string. We keep this dependency-free to
 * avoid pulling in `gray-matter`/`js-yaml` for a known-shape file format.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };

  const yaml = raw.slice(3, end).replace(/^\r?\n/, "");
  const bodyStart = end + 4;
  const body = raw.slice(bodyStart).replace(/^\r?\n/, "");

  const data: Record<string, unknown> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value: string = trimmed.slice(colon + 1).trim();
    if (!key) continue;

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Inline list: [a, b, c]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (!inner) {
        data[key] = [];
      } else {
        data[key] = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
      }
      continue;
    }

    data[key] = value;
  }

  return { data, body };
}

/**
 * Verify a GitHub-style HMAC signature header (sha256=...) against the raw
 * request body. Returns true on match, false otherwise. Constant-time.
 *
 * Used by the sync webhook so a leaked URL can't be replayed by an
 * attacker — they'd also need the shared secret.
 */
export function verifyHmac(
  signatureHeader: string | null,
  rawBody: string,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

type SyncResult = {
  pack_id: string;
  commit_sha: string;
  files_synced: number;
  files_deleted: number;
};

/**
 * Pull the latest state of a pack's repo into Supabase. Idempotent.
 *
 * 1. Resolve the default branch's HEAD commit SHA.
 * 2. Fetch the recursive tree at that SHA.
 * 3. For each .md file under /docs (and the root manifest.json + OVERVIEW.md),
 *    fetch raw content, parse frontmatter, upsert.
 * 4. Reconcile: delete DB rows for paths that no longer exist in the tree.
 * 5. Update pack metadata (last_synced_at, last_commit_sha, manifest).
 */
export async function syncPack(packId: string): Promise<SyncResult> {
  const supabase = supabaseAdmin();

  const { data: pack, error: packErr } = await supabase
    .from("knowledge_packs")
    .select("*")
    .eq("id", packId)
    .single();

  if (packErr || !pack) {
    throw new Error(`Pack not found: ${packId}`);
  }

  const gh = octokit();
  const owner = pack.repo_owner as string;
  const repo = pack.repo_name as string;
  const branch = (pack.default_branch as string) || "main";

  // 1. HEAD commit SHA
  const { data: ref } = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const commitSha = ref.object.sha;

  // 2. Recursive tree
  const { data: tree } = await gh.git.getTree({
    owner,
    repo,
    tree_sha: commitSha,
    recursive: "true",
  });

  // 3. Filter to syncable files
  const syncable = (tree.tree || []).filter((entry) => {
    if (entry.type !== "blob" || !entry.path) return false;
    const path = entry.path;
    if (path === "manifest.json") return true;
    if (path === "OVERVIEW.md") return true;
    if (path.startsWith("docs/") && path.endsWith(".md")) return true;
    return false;
  });

  let manifestJson: Record<string, unknown> | null = null;
  const upsertedPaths: string[] = [];

  // Fetch + upsert each file. Sequential to stay friendly to the GH API
  // unauth rate limit (60 rph) — for an authed token (5000 rph) this is fine.
  for (const entry of syncable) {
    const path = entry.path!;
    const sha = entry.sha!;

    const { data: blob } = await gh.git.getBlob({ owner, repo, file_sha: sha });
    const raw =
      blob.encoding === "base64"
        ? Buffer.from(blob.content, "base64").toString("utf-8")
        : blob.content;

    if (path === "manifest.json") {
      try {
        manifestJson = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Bad manifest is non-fatal — pack still works without it.
      }
      continue;
    }

    const { data: fmData, body } = parseFrontmatter(raw);
    const title = stringOrNull(fmData.title) ?? deriveTitleFromPath(path);
    const summary = stringOrNull(fmData.summary);
    const tags = stringArray(fmData.tags);
    const category = derivePackCategory(path);

    const { error: upErr } = await supabase.from("knowledge_pack_files").upsert(
      {
        pack_id: packId,
        path,
        title,
        summary,
        body,
        frontmatter: fmData,
        tags,
        category,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "pack_id,path" }
    );
    if (upErr) {
      throw new Error(`Failed to upsert ${path}: ${upErr.message}`);
    }
    upsertedPaths.push(path);
  }

  // 4. Reconcile deletions — drop any DB rows for paths no longer in the tree.
  let filesDeleted = 0;
  if (upsertedPaths.length > 0) {
    const { data: deleted, error: delErr } = await supabase
      .from("knowledge_pack_files")
      .delete()
      .eq("pack_id", packId)
      .not("path", "in", `(${upsertedPaths.map((p) => `"${p}"`).join(",")})`)
      .select("path");
    if (delErr) {
      throw new Error(`Failed to reconcile deletions: ${delErr.message}`);
    }
    filesDeleted = deleted?.length ?? 0;
  }

  // 5. Update pack metadata
  await supabase
    .from("knowledge_packs")
    .update({
      last_synced_at: new Date().toISOString(),
      last_commit_sha: commitSha,
      manifest: manifestJson ?? pack.manifest,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId);

  return {
    pack_id: packId,
    commit_sha: commitSha,
    files_synced: upsertedPaths.length,
    files_deleted: filesDeleted,
  };
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function stringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/**
 * Derive a category from the file path. Files under /docs/<category>/...
 * get that first segment; everything else gets null. The MCP tool exposes
 * this as a cheap filter so an agent can scope `kb_list({ category })`.
 */
function derivePackCategory(path: string): string | null {
  const docsPrefix = "docs/";
  if (!path.startsWith(docsPrefix)) return null;
  const rest = path.slice(docsPrefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return rest.slice(0, slash);
}

function deriveTitleFromPath(path: string): string {
  const file = path.split("/").pop() || path;
  return file.replace(/\.md$/, "").replace(/[-_]/g, " ");
}
