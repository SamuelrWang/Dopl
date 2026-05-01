/**
 * Stub. The skills feature originally cross-referenced
 * `HARDCODED_KBS` from `src/features/knowledge/data.ts`. Item 5.A.4
 * deleted that legacy fixture file; this stub returns null so the
 * skills UI gracefully degrades — "Knowledge sources" sections render
 * the slug itself instead of a friendly KB name.
 *
 * The skills feature is itself entirely hardcoded; a real KB lookup
 * lives in `src/features/knowledge/client/api.ts` (`fetchBaseBySlug`)
 * and is out-of-scope for this overhaul. If the skills feature ever
 * goes DB-backed, replace this stub with the real lookup.
 */

interface LegacyKnowledgeBaseInfo {
  name: string;
  entries: ReadonlyArray<unknown>;
}

export function findKnowledgeBase(slug: string): LegacyKnowledgeBaseInfo | null {
  void slug;
  return null;
}
