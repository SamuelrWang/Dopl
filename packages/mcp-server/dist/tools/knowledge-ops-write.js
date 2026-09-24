"use strict";
/**
 * `dopl_kb` TREE writes — what lives INSIDE a base: create a folder, move a
 * folder or an entry, write an entry, and the AUTHORING RULES those entries
 * owe. Routed from the registrar in `knowledge.ts`.
 *
 * ⚠ **THE BASE OPS LEFT ON 2026-09-18 (A3)** for
 * `knowledge-ops-base-writes.ts`, which carries the seam's argument: a base is
 * a container with an AUDIENCE, a folder or an entry is a PATH inside one whose
 * audience is already settled. This file was at §1's 500-line hard cap, so the
 * split came before the edit. The base ops are re-exported below, so no
 * importer moved. ⚠ The GRANT went further out still, to
 * `knowledge-ops-grant.ts`: it writes no base content, it lends one.
 *
 * ⚠ **AND THE AUTHORING RULES THEMSELVES LIVE IN `knowledge-write-rules.ts`**,
 * which is where the predicates and the refusal sentences are; this file
 * decides WHEN to ask them.
 *
 * ⚠ Errors map as they always did — conflict (412), already-exists (409),
 * agent-write-denied (403), validation (400) — and anything unmapped rethrows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opUpdateBase = exports.opSetVisibility = exports.opCreateBase = void 0;
exports.opCreateFolder = opCreateFolder;
exports.opMove = opMove;
exports.opWriteFile = opWriteFile;
const call_ref_js_1 = require("../call-ref.js");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const tool_errors_1 = require("./tool-errors");
const knowledge_shared_1 = require("./knowledge-shared");
// ⚠ THE `zod` → SENTENCE TRANSLATION LIVES APART (S52, 2026-09-18) — see
// `knowledge-validation.ts`'s header for the seam and for the rule it enforces.
const knowledge_validation_1 = require("./knowledge-validation");
const channel_shared_1 = require("./channel-shared");
const knowledge_sections_1 = require("./knowledge-sections");
// ⚠ RE-EXPORTED, NOT RE-IMPLEMENTED — `knowledge.ts` and four suites address
// the base ops through this module's name, and a split is not a reason to move
// every call site.
var knowledge_ops_base_writes_1 = require("./knowledge-ops-base-writes");
Object.defineProperty(exports, "opCreateBase", { enumerable: true, get: function () { return knowledge_ops_base_writes_1.opCreateBase; } });
Object.defineProperty(exports, "opSetVisibility", { enumerable: true, get: function () { return knowledge_ops_base_writes_1.opSetVisibility; } });
Object.defineProperty(exports, "opUpdateBase", { enumerable: true, get: function () { return knowledge_ops_base_writes_1.opUpdateBase; } });
const knowledge_write_rules_1 = require("./knowledge-write-rules");
// ⚠ THE `&amp;`-IN-A-TITLE RULE LIVES APART — `knowledge-entity-titles.ts`
// carries both lanes (the write-side note here, the read-side signal there).
const knowledge_entity_titles_1 = require("./knowledge-entity-titles");
/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a title
 * derived from a path), spliced into our own narration — and a path can carry a
 * backtick, since `NAME_RE` bans control and zero-width characters, NOT
 * markdown. A path is a VALUE.
 *
 * The fallbacks themselves are `narration.ts › NO_NAME` / `NO_PATH` (2026-09-17).
 */
async function opCreateFolder(client, ref, path, description) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    // ⚠ **THE 400 WAS RETHROWN RAW UNTIL 2026-09-18 (S52).** `description` is
    // capped at 300 like an entry's `excerpt`, and this op had no mapper at all —
    // so the folder half of the pair reached the agent as an unhandled
    // `VALIDATION_FAILED` with no field, no number and no remedy.
    const folder = await (0, knowledge_shared_1.writeOr)(() => client.createKbFolderByPath(base.id, path, description), knowledge_validation_1.createFolderValidationError);
    if ((0, channel_shared_1.isErr)(folder))
        return folder;
    const descNote = description !== undefined ? " Description set." : "";
    return (0, respond_1.ok)(`Folder ready at ${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)} (id: \`${folder.id}\`).${descNote}`);
}
/**
 * `move_folder` and `move_file` — ONE mover (2026-09-17). They were two
 * functions differing only in a noun: `moveKbByPath` is path-addressed and
 * kind-agnostic, so the only per-op logic is checking that the path resolved to
 * the KIND the caller named — which is a refusal, because moving an entry on a
 * `move_folder` would be a write the caller never asked for.
 */
async function opMove(client, ref, from_path, to_path, kind) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const result = await (0, knowledge_shared_1.writeOr)(() => client.moveKbByPath(base.id, from_path, to_path));
    if ((0, channel_shared_1.isErr)(result))
        return result;
    if (result.kind !== kind) {
        return (0, respond_1.err)(`Path ${(0, narration_1.inlineOr)(from_path, narration_1.NO_PATH)} resolved to a ${result.kind}, not ${kind === "folder" ? "a folder" : "an entry"}.`);
    }
    const noun = kind === "folder" ? "Folder" : "Entry";
    return (0, respond_1.ok)(`${noun} moved: ${(0, narration_1.inlineOr)(from_path, narration_1.NO_PATH)} → ${(0, narration_1.inlineOr)(to_path, narration_1.NO_PATH)}.`);
}
/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * 🔒 **THE AUTHORING RULES RUN BEFORE THE WRITE, AND TWO OF THEM REFUSE IT**
 * (Samuel's ruling 2026-09-18, option A). An agent save with no real summary,
 * and a long body with no `##` headings, are REFUSED — *"saves should be
 * blocked if there's no description"*. A human typing in the app is never
 * blocked: that half of the ruling lives in the editor, and nothing on this
 * surface can reach a person. The two remaining rules — a pointer that names no
 * path, and a buried supersession marker — are nudges on a landed write.
 *
 * ⚠ **THE RESULT STILL ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which
 * is the addresses the next read can use. `unsectionedNudge` survives for the
 * `section=` path alone, where the merged body is the server's and a pre-write
 * length test would measure the wrong document.
 */
async function opWriteFile(client, ref, path, body, title, expected_version, force, excerpt, section, clientWriteId) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    // 🔒 **REFUSED BEFORE THE WRITE, NEVER AFTER IT.** A rule reported on a
    // success is a rule the agent has already decided it does not need, and a
    // refusal printed over a row that landed is worse than no rule at all.
    const unsectioned = (0, knowledge_write_rules_1.unsectionedRefusal)(body, section);
    if (unsectioned)
        return (0, respond_1.err)(unsectioned);
    const excerptVerdict = await excerptVerdictFor(client, base.id, path, title, excerpt);
    if (excerptVerdict)
        return (0, respond_1.err)(excerptVerdict);
    const res = await (0, knowledge_shared_1.writeOr)(() => client.writeKbFileByPath(base.id, path, { body, title, excerpt, section, clientWriteId }, force ? null : expected_version), (e) => {
        // ⚠ THE ONE REFUSAL `section` ADDS, and it is a refusal rather than a
        // first-match because the write it would have made is unrecoverable.
        if ((0, respond_1.isApiError)(e, 409, "KNOWLEDGE_SECTION_AMBIGUOUS")) {
            return (0, respond_1.err)(`reason=SECTION_AMBIGUOUS · ${(0, respond_1.apiMessage)(e) ?? "that heading names more than one section."} · retry=none, they have the same name\n\nNOTHING was written. Rename one of them, or drop \`section\` and write the whole body.`);
        }
        // 🔒 **THE TARGET VANISHED, AND IT IS NOT A VERSION PROBLEM (S40,
        // 2026-09-18).** Discriminated on the CODE and placed BEFORE both
        // status-only arms below, which would otherwise read this 409 as
        // "an entry with that title already exists" — the opposite fact.
        if ((0, respond_1.isApiError)(e, 409, "KNOWLEDGE_TARGET_VANISHED")) {
            return (0, respond_1.err)((0, tool_errors_1.refusal)(tool_errors_1.KB_TARGET_VANISHED, `NOTHING was written at ${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)}. A path is a POSITION, not an identity: ${(0, call_ref_js_1.callRef)("kb.move_file", {}, { form: "op" })} and a retitle both vacate one. ⚠ Do NOT re-issue this call with force=true — write_file is an UPSERT, so a forced write at a vacated path CREATES A SECOND ENTRY that nothing afterwards can tell from the first. Find where it went with ${(0, call_ref_js_1.callRef)("kb.list_dir", {}, { form: "op" })} (or ${(0, call_ref_js_1.callRef)("kb.get_tree", {}, { form: "op" })}), then write at the path it is at now. An ENTRY ID survives a move; a path does not.`));
        }
        // ⚠ **THE MOVE AND THE DUPLICATE RISK ARE NAMED HERE TOO (S40).** A
        // conflict says somebody wrote after your read — and the write that
        // "somebody" made may have been a MOVE, in which case the path you are
        // holding is about to stop resolving. An agent told only "reconcile and
        // retry" reaches for `force`, which is the one input that used to walk
        // past the server's own anti-duplicate guard.
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)((0, tool_errors_1.refusal)((0, tool_errors_1.versionConflict)("kb.read_file"), `NOTHING was written at ${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)}. Read it again for the current body and Version, reconcile, then re-issue with that expected_version. ⚠ The other write may have MOVED or RENAMED this entry rather than edited it — check ${(0, call_ref_js_1.callRef)("kb.list_dir", {}, { form: "op" })} before you retry, because write_file is an UPSERT and a forced write at a vacated path creates a DUPLICATE rather than overwriting anything.`));
        }
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An entry titled ${(0, narration_1.inlineOr)(title ?? path.split("/").filter(Boolean).pop(), narration_1.NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with ${(0, call_ref_js_1.bySet)({ legacy: (0, call_ref_js_1.legacyOnly)('dopl_kb(op="read_file" → "write_file")'), granular: `${(0, call_ref_js_1.callRef)("kb.read_file")} → ${(0, call_ref_js_1.callRef)("kb.write_file")}` })}.`);
        }
        // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
        return (0, knowledge_validation_1.writeFileValidationError)(e, title);
    });
    if ((0, channel_shared_1.isErr)(res))
        return res;
    const { entry, outline, sectionCreated } = res;
    // 🔒 **THE CONVERGED RESULT SAYS SO, FIRST, AND IT IS NOT AN ERROR** (S53).
    // The row came back off `client_write_id`, so THIS call wrote nothing and the
    // body stored is the FIRST call's. An agent told only "Wrote …" over a
    // converged result would believe its second, different body is what is saved
    // — which is worse than the timeout it was recovering from.
    // ⚠ `retry=none` BECAUSE THE WRITE LANDED: the same grammar the PIN_LARGE
    // warning uses for a nudge that rides a SUCCESS, so nothing here reads as a
    // refusal. ⚠ `?? false` (INVARIANTS §8): an older server sends no such key and
    // absent must read as "this call wrote", the behaviour before the field.
    const convergedNote = (res.converged ?? false)
        ? `reason=converged · this call wrote NOTHING — client_write_id matched an earlier write of yours, and what is below is THAT write's entry · retry=none, it landed. If the body you just sent differs from the stored one, read_file it and write again with a NEW key.`
        : null;
    // ⚠ The addressable path's leaf is the entry's TITLE, not the input path's
    // leaf segment — print it, and surface the canonical form when a passed
    // `title` slugs differently from the input leaf.
    const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
    const canonicalPath = [...parentSegments, entry.title].join("/");
    const note = canonicalPath !== path
        ? ` Address future reads/moves with path ${(0, narration_1.inlineOr)(canonicalPath, narration_1.NO_PATH)}.`
        : "";
    // ⚠ THE NUDGE LEADS, because a `reason=` line read after the success sentence
    // is a line an agent has already decided it does not need.
    // ⚠ **ONLY THE `section=` PATH CAN STILL REACH IT.** A whole-body write that
    // would trip this was refused above, before anything was written; here the
    // merged body is the server's and this is the first place its length is known.
    const unsectionedLanded = entry.body.length > knowledge_sections_1.KB_SECTION_NUDGE_CHARS &&
        (outline?.sections.length ?? 0) === 0;
    // ⚠ NUDGES, NOT REFUSALS (the ruling names two refusals and these are not
    // them) — and they run on the body the caller SENT, which is the prose this
    // call is responsible for even when the server merged it into more.
    const advisories = [(0, knowledge_write_rules_1.crossRefNudge)(body), (0, knowledge_write_rules_1.supersessionNudge)(body)].filter((l) => l !== null);
    const sectionNote = section === undefined
        ? ""
        : sectionCreated
            ? ` Section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")} did not exist and was APPENDED at \`##\` level.`
            : ` Replaced section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")}; the rest of the entry is untouched.`;
    return (0, respond_1.ok)([
        ...(convergedNote ? [convergedNote, ""] : []),
        ...(unsectionedLanded ? [(0, knowledge_sections_1.unsectionedNudge)(), ""] : []),
        ...(advisories.length > 0 ? [...advisories, ""] : []),
        // ⚠ **THE VERSION SAYS WHAT IT IS FOR (A3/S34, 2026-09-18).** The returned
        // version ALREADY works as the next call's `expected_version`
        // (`service-paths.ts` compares `updatedAt` string-equal), and only
        // `read_file` said so — so an agent correcting its own write re-read the
        // entry it had just written, or reached for `force=true`, which disarms
        // the server's anti-duplicate guard. The parenthetical is `read_file`'s,
        // word for word, because two wordings read as two facts.
        `Wrote ${(0, narration_1.inlineOr)(canonicalPath, narration_1.NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\` (pass as expected_version to write_file).${note}${sectionNote}${(0, knowledge_entity_titles_1.titleDecodedNote)(title, entry.title)}`,
        ...[(0, knowledge_sections_1.outlineFooter)(outline)].filter((l) => l !== null),
    ].join("\n"));
}
/**
 * 🔒 **WHAT THE ENTRY WILL HAVE AS A SUMMARY ONCE THIS WRITE LANDS** — which is
 * not the same question as "what did the caller pass" (2026-09-18).
 *
 * ⚠ **AN OMITTED `excerpt` PRESERVES THE STORED ONE** (the field's own
 * contract: *"on an update it changes only when provided"*), so refusing every
 * omission would refuse the ordinary update of an entry that is already
 * summarised — including every `section=` write. The only honest test is
 * against the value that will be there afterwards, so when the argument is
 * absent this reads the row to find out.
 *
 * ⚠ **ONE EXTRA ROUND TRIP, AND ONLY ON THE OMISSION.** A caller that passes an
 * excerpt is judged on it and reads nothing; the probe is the price of leaving
 * the field out, which is the behaviour the rule exists to discourage.
 *
 * ⚠ **THE PROBE FAILS OPEN, DELIBERATELY.** A rule this process could not
 * measure is not a rule it may assert: a 404 is a CREATE (no stored excerpt to
 * inherit, so the refusal stands), and any other failure means "unknown", where
 * blocking the user's content on our own transport error would be the worse
 * error by far. The server's gates still run either way.
 */
async function excerptVerdictFor(client, baseId, path, title, excerpt) {
    const leaf = path.split("/").filter(Boolean).pop() ?? path;
    if (excerpt !== undefined)
        return (0, knowledge_write_rules_1.excerptRefusal)(excerpt, title ?? leaf);
    let stored;
    try {
        const existing = await client.readKbFileByPath(baseId, path);
        stored = existing.excerpt;
        // ⚠ The STORED title is the one the rule compares against when the caller
        // passes none — a summary that restates a title it never sent is still a
        // summary that says nothing.
        return (0, knowledge_write_rules_1.excerptRefusal)(stored, title ?? existing.title);
    }
    catch (e) {
        if (typeof e === "object" && e !== null && e.status === 404) {
            return (0, knowledge_write_rules_1.excerptRefusal)(undefined, title ?? leaf);
        }
        return null;
    }
}
/** ⚠ `op="grant"` MOVED OUT on 2026-09-18 — `knowledge-ops-grant.ts`. This
 *  file was on the 500-line cap. */
