"use strict";
/**
 * `dopl_kb(op="pin" | "unpin")` — the PINNED STARTUP CONTEXT (T81), and the
 * ceiling on what it may cost (Samuel's ruling 2026-09-03).
 *
 * ⚠ **ITS OWN FILE SINCE THE CEILING LANDED.** The pin is the one write on this
 * tool whose cost is paid by somebody who is not the caller — every agent
 * session this workspace launches afterwards — so it grew a measurement, a
 * warning and a refusal that no other write has. Splitting it keeps
 * `knowledge-ops-write.ts` inside the 500-line cap and puts the whole of the
 * launch-budget argument in one place.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opPin = opPin;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const knowledge_sections_1 = require("./knowledge-sections");
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";
/**
 * What the CURATED pinned set costs, or `null` when it could not be measured.
 *
 * ⚠ **A FAILED MEASUREMENT NEVER FAILS A PIN.** The cap exists to inform a
 * curation decision; a transport error on the read that informs it is not a
 * reason to refuse the write, and turning one into the other would make the
 * feature the reason pinning stopped working.
 *
 * ⚠ **`pinnedChars` FALLS BACK TO `chars` (INVARIANTS §8).** An older server
 * sends no such key, and `chars` is bounded by the 8k delivery cap — so the
 * fallback is a FLOOR, which can only ever under-warn. Under-warning is the
 * safe direction for a bound that refuses.
 */
async function pinnedChars(client) {
    try {
        const ctx = await client.getKbStartupContext();
        return ctx.pinnedChars ?? ctx.chars ?? 0;
    }
    catch {
        return null;
    }
}
/** The per-launch cost sentence both the warning and the refusal are built on. */
function costLine(chars) {
    return `${chars.toLocaleString("en-US")} characters of pinned content are now prepended to EVERY agent session launched in this workspace — paid on each start, whether or not the session needed it.`;
}
/**
 * PINNED STARTUP CONTEXT (T81) — put a base (or one entry of it) into what every
 * agent session launched in this workspace is handed at startup, or take it out.
 *
 * ⚠ ONE HANDLER, TWO OPS, AND THE BOOLEAN IS THE ONLY DIFFERENCE. `pin` and
 * `unpin` are separate ops rather than one op with a flag for the reason the
 * REST routes are two verbs: a request that states the END STATE is safe to
 * retry after an ambiguous failure, where a toggle silently un-does a write that
 * landed. On workspace-wide state that un-do changes what every session started
 * afterwards begins with.
 *
 * ⚠ `path` IS WHAT PICKS THE TARGET, and the two are different objects: with a
 * path this pins ONE ENTRY, without it the WHOLE BASE. The result says which,
 * because an agent that believes it pinned a base when it pinned one document
 * will not pin the rest.
 *
 * ⚠ **THERE IS NO `section` ON THIS OP, AND IT IS NOT AN OVERSIGHT.** A section
 * read is computed at READ time from the markdown; a pinned section would have
 * to be REMEMBERED — a heading stored on the row, re-resolved by
 * `service-startup-context.ts` on every launch, and silently emptied the day
 * somebody renames the heading. That is a stored pointer into a document's
 * prose, which is a different feature with a different failure mode. The
 * refusal below suggests pinning a smaller ENTRY instead, and says so.
 *
 * ⚠ **THE CEILING IS MEASURED AFTER THE WRITE AND REVERTED, NOT PREDICTED.**
 * A base pin's cost is the sum of every entry in it, which this process cannot
 * know without reading them all — so the honest measurement is the one the
 * server makes, and the write that overshoots is undone with the idempotent
 * verb that exists for exactly this. ⚠ A revert only ever fires when the write
 * CHANGED something (`after > before`), so re-pinning something already pinned
 * cannot un-pin it.
 */
async function opPin(client, ref, path, pinned) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, knowledge_shared_1.isErr)(base))
        return base;
    const verb = pinned ? "Pinned" : "Unpinned";
    // ⚠ An UNPIN only ever shrinks the payload, so it is never measured. Reading
    // the startup context twice to prove a set got smaller is two round trips
    // spent on a fact nobody can act on.
    const before = pinned ? await pinnedChars(client) : null;
    try {
        if (path === undefined || path === "") {
            await client.setKbBasePinned(base.id, pinned);
            const capped = await enforceCap(client, before, () => client.setKbBasePinned(base.id, false));
            if (capped.refusal)
                return capped.refusal;
            return (0, respond_1.ok)([
                ...(capped.warning ? [capped.warning, ""] : []),
                `${verb} knowledge base ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${pinned ? "Every entry in it is now included in the startup context of agent sessions launched in this workspace." : "Its entries are no longer included in the startup context of new agent sessions."}`,
            ].join("\n"));
        }
        // ⚠ A PART read rather than a whole one: the entry id is all this write
        // needs, and the outline is what the refusal has to print. The body never
        // crosses the wire.
        const read = await client.readKbFilePart(base.id, path, { outline: true });
        await client.setKbEntryPinned(read.entry.id, pinned);
        const capped = await enforceCap(client, before, () => client.setKbEntryPinned(read.entry.id, false), read.outline, path);
        if (capped.refusal)
            return capped.refusal;
        return (0, respond_1.ok)([
            ...(capped.warning ? [capped.warning, ""] : []),
            `${verb} ${(0, narration_1.inlineOr)(path, NO_PATH)} in ${(0, narration_1.inlineOr)(base.name, NO_NAME)} (entry id: \`${read.entry.id}\`). ${pinned ? "This ONE entry is now included in the startup context of agent sessions launched in this workspace — the rest of the base is not." : "It is no longer included on its own; if its BASE is pinned it still arrives with the base."}`,
            ...(pinned ? [(0, knowledge_sections_1.outlineFooter)(read.outline) ?? ""].filter(Boolean) : []),
        ].join("\n"));
    }
    catch (e) {
        // Read-only-to-agents base — clean message, not a raw dump.
        const denied = (0, knowledge_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No entry at ${(0, narration_1.inlineOr)(path, NO_PATH)} in ${(0, narration_1.inlineOr)(base.name, NO_NAME)}, so nothing was ${pinned ? "pinned" : "unpinned"}. Paths must resolve to an ENTRY, not a folder — check dopl_kb(op="get_tree", base) for the exact path, or omit \`path\` to ${pinned ? "pin" : "unpin"} the whole base.`);
        }
        throw e;
    }
}
/**
 * Weigh the pinned set after a pin: warn past {@link KB_PIN_WARN_CHARS}, revert
 * and refuse past {@link KB_PIN_MAX_CHARS}.
 *
 * ⚠ **`before === null` MEANS "NOT MEASURED", AND EVERY CLAUSE FAILS OPEN ON
 * IT.** That is an unpin, or a measurement that errored — neither is licence to
 * undo a write that landed.
 */
async function enforceCap(client, before, revert, outline, path) {
    if (before === null)
        return {};
    const after = await pinnedChars(client);
    if (after === null || after <= knowledge_sections_1.KB_PIN_WARN_CHARS)
        return {};
    if (after <= knowledge_sections_1.KB_PIN_MAX_CHARS || after <= before) {
        return { warning: `reason=PIN_LARGE · ${costLine(after)} · retry=none, the pin landed` };
    }
    await revert();
    const suggestion = outline && outline.sections.length > 0
        ? [
            "",
            `This entry is ${outline.totalChars.toLocaleString("en-US")} chars across ${outline.sections.length} headings:`,
            ...(0, knowledge_sections_1.renderOutline)(outline),
            "",
            `There is no way to pin ONE section — a pinned section would be a stored pointer into prose that a rename empties. Split ${(0, narration_1.inlineOr)(path ?? "", NO_PATH)} into separate entries and pin the one a session actually needs.`,
        ]
        : [
            "",
            `Pin ONE entry instead of the whole base (pass \`path\`), or unpin something first — dopl_kb(op="list_bases") marks what is pinned.`,
        ];
    return {
        refusal: (0, respond_1.err)([
            `reason=PIN_LARGE · REFUSED and REVERTED — nothing is pinned that was not pinned before this call.`,
            `${after.toLocaleString("en-US")} chars would exceed the ${knowledge_sections_1.KB_PIN_MAX_CHARS.toLocaleString("en-US")}-char ceiling. Past ~8,000 the launch payload ships POINTERS rather than content, so a pin this large does not add what it looks like it adds — it makes it likelier that something already pinned is the thing demoted.`,
            ...suggestion,
        ].join("\n")),
    };
}
