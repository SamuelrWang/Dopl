"use strict";
/**
 * `dopl_kb` op="grant" — the one op that LENDS a base to a channel, container or
 * team. Split out of `knowledge-ops-write.ts` on 2026-09-18, which was sitting
 * on the 500-line cap; it is the same seam `knowledge-ops-pin.ts` already takes,
 * one op and the `grant.ts` vocabulary it alone speaks. Routed from the
 * registrar in knowledge.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opGrantBase = opGrantBase;
const channel_shared_1 = require("./channel-shared");
const knowledge_shared_1 = require("./knowledge-shared");
const grant_1 = require("./grant");
/**
 * `op="grant"` — lend ONE base to a channel, container or team. The op that
 * REPLACED `op="copy_base"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THE RESOLVE IS THE ORDINARY ONE.** `resolveBaseOr` answers what this
 * caller may see, `notOwnedRefusal` then narrows that to what they CREATED (R2),
 * and the server repeats both — this tier exists to spend no round trip on a
 * refusal it can already prove and to say WHY, where the server's uniform 404
 * deliberately cannot.
 */
async function opGrantBase(client, directory, selfUserId, ref, scope, to, level) {
    const chosen = (0, grant_1.levelForScope)(scope, level);
    if ((0, grant_1.isGrantRefusal)(chosen))
        return chosen;
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const notOwned = (0, grant_1.notOwnedRefusal)(base.createdBy, selfUserId, "knowledge base", base.name);
    if (notOwned)
        return notOwned;
    const scopeId = await (0, grant_1.resolveGrantScopeId)(directory, scope, to);
    if ((0, grant_1.isGrantRefusal)(scopeId))
        return scopeId;
    try {
        await client.grantResource({
            resourceType: "knowledge_base",
            resourceId: base.id,
            scopeType: scope,
            scopeId,
            level: chosen,
        });
    }
    catch (e) {
        // 🔒 The container-KIND refusal, said in this surface's own words rather
        // than as a bare 400 (Samuel's ruling 2026-09-17). Every other failure
        // rethrows — a catch that swallowed them would report a refusal for an
        // outage.
        const refused = (0, grant_1.channelScopeRefusal)(e);
        if (refused)
            return refused;
        throw e;
    }
    return (0, grant_1.grantedLine)("knowledge base", base.name, scope, scopeId, chosen);
}
