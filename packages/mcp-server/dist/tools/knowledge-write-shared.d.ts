/**
 * The two helpers BOTH `dopl_kb` write lanes need — the BASE lane
 * (`knowledge-ops-base-write.ts`) and the ENTRY/FOLDER lane
 * (`knowledge-ops-write.ts`).
 *
 * ⚠ **THIS MODULE EXISTS BECAUSE OF §1's 500-LINE CAP**, not because the two
 * helpers wanted a home: `knowledge-ops-write.ts` sat AT the cap, so the base
 * ops moved out and these came with them rather than being imported ACROSS the
 * new seam in one direction and back in the other.
 */
import { type ToolResponse } from "./respond";
/**
 * Run a write, mapping the ONE 403 EVERY base write can raise. Six hand-written
 * copies of this catch lived in one file (2026-09-17).
 *
 * ⚠ `more` runs FIRST, for the per-op codes — 409, 412 and 400, every one of
 * them disjoint from `AGENT_WRITE_DISABLED`, so the order is a convenience and
 * not a precedence. Anything neither maps RETHROWS: a catch that swallowed an
 * outage would report it as a refusal.
 */
export declare function writeOr<T>(run: () => Promise<T>, more?: (e: unknown) => ToolResponse | null): Promise<T | ToolResponse>;
/**
 * A 403 `AGENT_WRITE_DISABLED` off `create_base` — ⚠ duck-typed on the CODE, the
 * shape every mapper in this lane follows, so no new error class crosses the
 * package boundary. Returns the server's own sentence, which is the one
 * place this refusal is worded.
 */
export declare function agentCreateForbidden(e: unknown): string | null;
