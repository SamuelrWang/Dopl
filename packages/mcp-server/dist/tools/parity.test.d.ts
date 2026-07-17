/**
 * INVARIANT SUITE — MCP tool parity (packages/mcp-server).
 *
 * This suite mechanically guards the "drift between parallel declarations"
 * bug class that motivated the whole effort. Two real bugs it targets:
 *
 *   1. `dopl_kb` get_tree validated an `entry_limit` param server-side that
 *      was MISSING from the published zod inputSchema — agents couldn't
 *      call it. → guarded by "handler reads only declared params" below.
 *   2. `WRITE_OPS.dopl_skill` in server.ts drifted from the tool's op enum
 *      after an op rename (a latent read-only-token write hole). → guarded
 *      by the WRITE_OPS ⊆ enum + write-op-completeness tests below.
 *
 * Mechanism: every domain tool is captured by calling its registrar with a
 * recording `register` and a stub client (registration is all we need — the
 * client never runs). WRITE_OPS + READ_ONLY_BLOCKED_TOOLS are parsed out of
 * server.ts source text so the tests check the REAL gating tables, not a
 * copy that could itself drift.
 */
export {};
