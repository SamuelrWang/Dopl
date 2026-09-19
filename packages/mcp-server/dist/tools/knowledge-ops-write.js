"use strict";
/**
 * `dopl_kb` ENTRY + FOLDER write handlers: create/move folders, write/move
 * entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 *
 * ⚠ **THE BASE LANE LEFT ON 2026-09-18** for `knowledge-ops-base-write.ts`
 * (create/update/set_visibility/grant on BASES). What forced the split is §1's
 * 500-line cap — this file sat AT it — and the seam is a reason to change: a
 * base is a CONTAINER with an audience, an entry is a DOCUMENT with a version.
 * `writeOr` and `agentCreateForbidden` went to `knowledge-write-shared.ts`, so
 * neither lane imports the other.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateFolder = opCreateFolder;
exports.opMove = opMove;
exports.opWriteFile = opWriteFile;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const knowledge_shared_1 = require("./knowledge-shared");
const knowledge_write_shared_1 = require("./knowledge-write-shared");
// ⚠ S33/S47 — the SAME string a read_file header prints, so the two compare.
const body_digest_1 = require("./body-digest");
const channel_shared_1 = require("./channel-shared");
const knowledge_sections_1 = require("./knowledge-sections");
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
    const folder = await (0, knowledge_write_shared_1.writeOr)(() => client.createKbFolderByPath(base.id, path, description));
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
    const result = await (0, knowledge_write_shared_1.writeOr)(() => client.moveKbByPath(base.id, from_path, to_path));
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
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
async function opWriteFile(client, ref, path, body, title, expected_version, force, excerpt, section) {
    const base = await (0, knowledge_shared_1.resolveBaseOr)(client, ref);
    if ((0, channel_shared_1.isErr)(base))
        return base;
    const res = await (0, knowledge_write_shared_1.writeOr)(() => client.writeKbFileByPath(base.id, path, { body, title, excerpt, section }, force ? null : expected_version), (e) => {
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
    const unsectioned = entry.body.length > knowledge_sections_1.KB_SECTION_NUDGE_CHARS &&
        (outline?.sections.length ?? 0) === 0;
    const sectionNote = section === undefined
        ? ""
        : sectionCreated
            ? ` Section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")} did not exist and was APPENDED at \`##\` level.`
            : ` Replaced section ${(0, narration_1.inlineOr)(section, "`(unreadable)`")}; the rest of the entry is untouched.`;
    return (0, respond_1.ok)([
        ...(unsectioned ? [(0, knowledge_sections_1.unsectionedNudge)(), ""] : []),
        `Wrote ${(0, narration_1.inlineOr)(canonicalPath, narration_1.NO_PATH)} (entry id: \`${entry.id}\`, ${(0, body_digest_1.bodyFact)(entry.body)}). New version: \`${entry.updatedAt}\`.${note}${sectionNote}`,
        ...[(0, knowledge_sections_1.outlineFooter)(outline)].filter((l) => l !== null),
    ].join("\n"));
}
