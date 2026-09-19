"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeOr = writeOr;
exports.agentCreateForbidden = agentCreateForbidden;
const knowledge_shared_1 = require("./knowledge-shared");
/**
 * Run a write, mapping the ONE 403 EVERY base write can raise. Six hand-written
 * copies of this catch lived in one file (2026-09-17).
 *
 * ⚠ `more` runs FIRST, for the per-op codes — 409, 412 and 400, every one of
 * them disjoint from `AGENT_WRITE_DISABLED`, so the order is a convenience and
 * not a precedence. Anything neither maps RETHROWS: a catch that swallowed an
 * outage would report it as a refusal.
 */
async function writeOr(run, more = () => null) {
    try {
        return await run();
    }
    catch (e) {
        const mapped = more(e) ?? (0, knowledge_shared_1.agentWriteDenied)(e);
        if (mapped)
            return mapped;
        throw e;
    }
}
/**
 * A 403 `AGENT_WRITE_DISABLED` off `create_base` — ⚠ duck-typed on the CODE, the
 * shape every mapper in this lane follows, so no new error class crosses the
 * package boundary. Returns the server's own sentence, which is the one
 * place this refusal is worded.
 */
function agentCreateForbidden(e) {
    if (typeof e !== "object" || e === null)
        return null;
    if (e.status !== 403)
        return null;
    if (e.code !== "AGENT_WRITE_DISABLED")
        return null;
    const msg = e.apiMessage;
    const detail = typeof msg === "string" && msg
        ? msg
        : "An agent cannot create a knowledge base here.";
    return `${detail} Nothing was created — no row, no slug taken, so retrying the same call will fail the same way.`;
}
