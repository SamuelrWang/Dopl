"use client";

/**
 * useWorkflowsRealtime — RETIRED 2026-08-07, kept as a stub.
 *
 * docs/RETIREMENT-UNWIRING-PLAN.md Phase 5 / decision D8. The workflows page is
 * unrouted (Phase 1) and the five workflow tables — `workflows`,
 * `workflow_steps`, `workflow_step_edges`, `workflow_knowledge_bases`,
 * `workflow_skills` — were dropped from the `supabase_realtime` publication by
 * `supabase/migrations/20260807100000_drop_workflow_tables_from_realtime.sql`.
 *
 * WHY A STUB AND NOT A DELETION. Hide-don't-delete: the rest of
 * `src/features/workflows` still runs (three hard runtime importers — trash,
 * seed-workspace, clusters), and this file is the documentation of what the
 * bindings WERE. What could not stay is the wiring: a live
 * `useWorkspaceTablesRealtime` call on an unpublished table is the quiet
 * failure — Realtime accepts the binding, the channel reports SUBSCRIBED, and
 * no event ever arrives — so it would look healthy while costing a
 * subscription per mount for nothing. The `WORKFLOW_TABLES` array is gone
 * rather than emptied for the same reason `dopl-desktop-app/test/
 * ui-sync-tables.test.mjs` re-derives the watched union from these files: a
 * `*_TABLES` array literal here IS the subscription contract that test reads
 * (it regexes the source; it does not import it), so leaving one behind —
 * even an empty or commented one — would assert a binding that no longer
 * exists.
 *
 * TO BRING WORKFLOWS BACK, all three halves move together: re-publish the five
 * tables (`ALTER PUBLICATION supabase_realtime ADD TABLE …` in a NEW migration
 * — never a revert, there is no replay for events missed while unpublished),
 * restore the `WORKFLOW_TABLES` literal + `useWorkspaceTablesRealtime` call
 * here, and put the five names back in `dopl-desktop-app/main/ui-sync.js`'s
 * `SYNC_TABLES`. The pairing test fails if any one of them lands alone.
 */
export function useWorkflowsRealtime(
  _workspaceId: string | null | undefined,
  _onChange: () => void
): void {
  // Intentionally inert — see the docblock. No hook is called, so this is safe
  // to invoke unconditionally from any render path that still imports it. The
  // signature is preserved so bringing workflows back is one edit here rather
  // than a refactor at every call site; `void` marks the arguments as
  // deliberately unread rather than forgotten.
  void _workspaceId;
  void _onChange;
}
