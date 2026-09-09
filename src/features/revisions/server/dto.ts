import "server-only";
import type {
  Revision,
  RevisionActorKind,
  RevisionOp,
  RevisionPayload,
  RevisionResourceType,
} from "../types";

/** `snake_case` → `camelCase`, and the ONLY place either spelling meets the
 *  other (INVARIANTS §2). */

/** ⚠ NAMED COLUMNS, NEVER `*` (INVARIANTS §9). `payload` is the heavy field and
 *  it is on the list because a revision without its snapshot is not a revision —
 *  the LIST is bounded by a page limit instead. */
// ⚠ ONE STRING LITERAL, NOT A CONCATENATION. `supabaseAdmin()` is an UNTYPED
// `SupabaseClient`, so PostgREST's row type is inferred from the select string
// as a LITERAL — a `"a" + "b"` widens to `string` and every `data` in the
// repository degrades to `GenericStringError`. The line is long for that reason.
export const REVISION_COLS = "id, resource_type, resource_id, workspace_id, actor_user_id, actor_kind, agent_session_id, op, summary, payload, content_hash, created_at, updated_at";

export interface RevisionRow {
  id: string;
  resource_type: string;
  resource_id: string;
  workspace_id: string;
  actor_user_id: string | null;
  actor_kind: string;
  agent_session_id: string | null;
  op: string;
  summary: string | null;
  payload: RevisionPayload | null;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export function mapRevisionRow(row: RevisionRow): Revision {
  return {
    id: row.id,
    resourceType: row.resource_type as RevisionResourceType,
    resourceId: row.resource_id,
    workspaceId: row.workspace_id,
    actor: {
      userId: row.actor_user_id,
      kind: row.actor_kind as RevisionActorKind,
      agentSessionId: row.agent_session_id,
    },
    op: row.op as RevisionOp,
    summary: row.summary,
    // ⚠ `?? {}` — the column is `NOT NULL DEFAULT '{}'`, but a narrowed
    // projection or an older row can still arrive without it, and an absent
    // snapshot must read as an empty one rather than crash a renderer
    // (INVARIANTS §8's stale-payload rule, applied at the row boundary).
    payload: row.payload ?? {},
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
