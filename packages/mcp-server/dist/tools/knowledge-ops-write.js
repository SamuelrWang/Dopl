"use strict";
/**
 * `dopl_kb` non-destructive WRITE op handlers for what lives INSIDE a base:
 * create/move folders, write/move entries. Every write maps @dopl/client errors
 * — conflict (412), already-exists (409), agent-write-denied (403), and
 * validation (400) — to actionable tool messages. Routed from the registrar in
 * knowledge.ts.
 *
 * ⚠ **THE BASE-LEVEL WRITES LEFT ON 2026-09-18** for the 500-line cap:
 * create_base / update_base / set_visibility / grant are
 * `knowledge-ops-base-writes.ts`. The seam is the SUBJECT — that file writes a
 * base, this one writes what is in it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateFolder = opCreateFolder;
exports.opMove = opMove;
exports.opWriteFile = opWriteFile;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const channel_shared_1 = require("./channel-shared");
const knowledge_sections_1 = require("./knowledge-sections");
const knowledge_write_rules_1 = require("./knowledge-write-rules");
/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name, a title derived from a path), spliced into our own
 * narration — and a path can carry a backtick, since `NAME_RE` bans control and
 * zero-width characters, NOT markdown. A name is a VALUE.
 *
 * The fallbacks themselves are `narration.ts › NO_NAME` / `NO_PATH` (2026-09-17).
 */
async function opCreateFolder(client, ref, path, description) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const folder = await (0, knowledge_shared_1.writeOr)(() => client.createKbFolderByPath(base.id, path, description));
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
async function opWriteFile(client, ref, path, body, title, expected_version, force, excerpt, section) {
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
    const res = await (0, knowledge_shared_1.writeOr)(() => client.writeKbFileByPath(base.id, path, { body, title, excerpt, section }, force ? null : expected_version), (e) => {
        // ⚠ THE ONE REFUSAL `section` ADDS, and it is a refusal rather than a
        // first-match because the write it would have made is unrecoverable.
        if ((0, respond_1.isApiError)(e, 409, "KNOWLEDGE_SECTION_AMBIGUOUS")) {
            return (0, respond_1.err)(`reason=SECTION_AMBIGUOUS · ${(0, respond_1.apiMessage)(e) ?? "that heading names more than one section."} · retry=none, they have the same name\n\nNOTHING was written. Rename one of them, or drop \`section\` and write the whole body.`);
        }
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`${(0, narration_1.inlineOr)(path, narration_1.NO_PATH)} changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`);
        }
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An entry titled ${(0, narration_1.inlineOr)(title ?? path.split("/").filter(Boolean).pop(), narration_1.NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`);
        }
        // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
        return (0, knowledge_shared_1.writeFileValidationError)(e, title);
    });
    if ((0, channel_shared_1.isErr)(res))
        return res;
    const { entry, outline, sectionCreated } = res;
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
        ...(unsectionedLanded ? [(0, knowledge_sections_1.unsectionedNudge)(), ""] : []),
        ...(advisories.length > 0 ? [...advisories, ""] : []),
        `Wrote ${(0, narration_1.inlineOr)(canonicalPath, narration_1.NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}${sectionNote}`,
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
