/**
 * ⚠ **{@link WorkspaceRole} AND {@link WorkspaceKind} ARE DECLARED IN
 * `@dopl/contracts › workspaces.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice
 * A13). Both were hand mirrors of `src/features/workspaces/types.ts`, and the
 * role set is the one with the longest drift history in this repo — it is why
 * `scripts/check-role-drift.ts` exists. No consumer import changed.
 *
 * ⚠ **`isStandardWorkspace` BELOW IS STILL A COPY, DELIBERATELY.**
 * `@dopl/contracts` is TYPE-ONLY (that is what lets it have no build and no
 * `dist/`), so a runtime predicate cannot live there. Both copies — and the
 * POSITIVE-form assertion over them, INVARIANTS §4A / F-295 — are still held by
 * `check-role-drift.ts › checkWorkspaceKind`, which is why that pass survives
 * while the set comparison beside it went.
 */
import type { WorkspaceRole, WorkspaceKind } from "@dopl/contracts";

export type { WorkspaceRole, WorkspaceKind };

export interface DoplEntry {
  id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string | null;
  use_case: string | null;
  complexity: string | null;
  status: "pending" | "pending_ingestion" | "processing" | "complete" | "error";
  readme: string | null;
  agents_md: string | null;
  manifest: Record<string, unknown> | null;
  descriptor?: string | null;
  ingestion_tier?: "skeleton" | "full" | null;
  tags?: { tag_type: string; tag_value: string }[];
  sources?: { source_type: string; url: string | null }[];
}

export interface SearchResult {
  entries: {
    entry_id: string;
    slug: string | null;
    title: string | null;
    summary: string | null;
    similarity: number;
    readme: string | null;
    agents_md: string | null;
    manifest: Record<string, unknown> | null;
    descriptor?: string | null;
    ingestion_tier?: "skeleton" | "full" | null;
  }[];
}

export interface BuildResult {
  status: "ready" | "no_matches";
  brief: string;
  constraints:
    | {
        preferred_tools?: string[];
        excluded_tools?: string[];
        max_complexity?: string;
        budget_context?: string;
      }
    | null;
  entries: Array<{
    entry_id: string;
    slug: string | null;
    title: string | null;
    similarity: number;
  }>;
  prompt: string;
  instructions: string;
}

export interface ListResult {
  entries: DoplEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkspaceSummary {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  publicId: string;
  description: string | null;
  /** Absent on servers predating the `workspaces.kind` column = `standard`. */
  kind?: WorkspaceKind;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shared kind predicate — every LISTING filters through this, no resolution does.
 *
 * ⚠ POSITIVE FORM (`=== "standard"`, never `!== "link"`), for the reason the
 * server twin spells out: the negative spelling would admit every kind added to
 * the union later, silently, into the one place this predicate exists to keep
 * kinds out of. ⚠ HAND-MIRRORED from `src/features/workspaces/types.ts ›
 * isStandardWorkspace` — F-295 is the standing entry on this duplication; edit
 * that one and copy it down.
 */
export function isStandardWorkspace(workspace: { kind?: WorkspaceKind }): boolean {
  return (workspace.kind ?? "standard") === "standard";
}

/**
 * Workspace + the caller's role. `client.listWorkspaces()` returns it so an
 * agent picks a workspace without a second round trip for the role.
 */
export interface WorkspaceListItem extends WorkspaceSummary {
  role: WorkspaceRole;
  /**
   * ACTIVE members of this workspace.
   *
   * ⚠ HAND-MIRRORED from `src/features/workspaces/types.ts › WorkspaceWithRole`,
   * and NO DRIFT GATE COVERS IT: `check-role-drift.ts` compares the role SET
   * (string-literal unions and flat record keys) and `check-knowledge-type-drift`
   * covers knowledge types. Both halves of this field must move in ONE change.
   *
   * 🔒 ⚠ OPTIONAL, AND ABSENT FAILS CLOSED. Read it as `?? 0` and treat ZERO as
   * "NOT SOLO" — an older server sends no count, and the safe reading of "I do
   * not know how many people are in this container" is that there is somebody in
   * it. `workspace-directory.ts › createWorkspaceDirectory` is the consumer, and
   * `factory.ts › bootServer` is where the `?? 0` lives.
   *
   * ⚠ NOT AN AUTHORIZATION FIELD. It decides how much of the directory an agent
   * is SHOWN — a TRIPWIRE. The fence is server-side
   * (`knowledge/server/service-audience.ts`), which re-reads this count itself.
   */
  memberCount?: number;
}

export interface ResolvedWorkspace {
  workspace: WorkspaceSummary;
  role: WorkspaceRole;
}

export interface PrepareIngestResult {
  status: "ready" | "already_exists";
  entry_id: string;
  slug: string | null;
  title?: string | null;
  message?: string;
  source_url?: string;
  source_platform?: string;
  thumbnail_url?: string | null;
  gathered_content?: string;
  gathered_content_chars?: number;
  images?: Array<{
    image_id: string;
    base64: string;
    mimeType: string;
  }>;
  prompts?: {
    content_type: string;
    classify_content: string;
    manifest_template: string;
    readme_templates: {
      setup: string;
      knowledge: string;
      article: string;
      reference: string;
    };
    agents_md_templates: {
      setup: string;
      knowledge: string;
      reference: string;
    };
    tags_fallback: string;
    image_vision: string;
  };
  instructions?: string;
}

export interface SubmitIngestedEntryInput {
  entry_id: string;
  content_type:
    | "setup"
    | "tutorial"
    | "knowledge"
    | "article"
    | "reference"
    | "resource";
  source_type: string;
  manifest: Record<string, unknown> & {
    title: string;
    description: string;
    use_case: { primary: string; secondary?: string[] };
    complexity: "simple" | "moderate" | "complex" | "advanced";
  };
  readme: string;
  agents_md: string;
  tags: Array<{ tag_type: string; tag_value: string }>;
  image_analyses?: Array<{
    image_id?: string;
    source_type:
      | "code_screenshot"
      | "architecture_diagram"
      | "image"
      | "other";
    raw_content: string;
    extracted_content: string;
    metadata?: Record<string, unknown>;
  }>;
  content_classification?: {
    sections?: Array<{
      title: string;
      classification: "EXECUTABLE" | "TACTICAL" | "CONTEXT" | "SKIP";
      reason: string;
      content_preview: string;
    }>;
    stats?: Record<string, unknown>;
    preservation_notes?: string[];
  };
}

export interface SubmitIngestedEntryResult {
  status: "complete";
  entry_id: string;
  slug: string;
  title: string;
  use_case: string;
  complexity: string;
  content_type: string;
}

export interface PendingIngestItem {
  entry_id: string;
  url: string;
  queued_at: string;
}

export interface PendingStatus {
  pending_ingestions: number;
  recent: PendingIngestItem[];
}

/**
 * Which counter a spend landed on. `personal` = the caller's own home-space
 * wallet; `seat` = their per-member allocation inside a standard workspace.
 * ⚠ **NOTHING IS POOLED PER WORKSPACE** — an allocation belongs to ONE person
 * (Samuel, 2026-09-07), so a refusal is about that person's counter, never
 * about a shared workspace balance.
 */
export type CreditWalletKind = "personal" | "seat";

/**
 * One MCP credit spend (`POST /api/mcp/credits/consume`).
 *
 * `allowed` is the only field the registrar acts on; counters are for refusal
 * wording. `degraded: true` = server FAILED OPEN — could not read the counter,
 * allowed the call anyway, numbers zeroed rather than invented.
 */
export interface CreditConsumeResponse {
  allowed: boolean;
  /**
   * Which wallet paid, so the refusal can name it.
   *
   * ⚠ **OPTIONAL ON THE WIRE, AND ITS ABSENCE NARROWS NOTHING.** A server that
   * predates the wallet split omits the key entirely, and `null` is the server
   * SAYING no wallet was charged (the unmetered/degraded posture). Both must
   * fall back to the generic refusal wording — reading a missing key as
   * "personal" would tell a workspace member their PERSONAL credits ran out.
   */
  wallet?: CreditWalletKind | null;
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
  /**
   * Where an exhausted caller is sent. **Empty when there is nothing to buy** —
   * a wallet already on its paid tier — and empty when the server failed open.
   * ⚠ **NON-EMPTY ON EITHER WALLET'S FREE VERDICT, INCLUDING `personal`**: a
   * personal PRO tier exists since 2026-09-08, so a reader must not treat
   * `wallet === "personal"` as proof that there is no link.
   */
  upgradeUrl: string;
  degraded?: boolean;
}
