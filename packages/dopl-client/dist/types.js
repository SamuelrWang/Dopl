"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStandardWorkspace = isStandardWorkspace;
/**
 * Shared kind predicate — every LISTING filters through this, no resolution does.
 *
 * ⚠ POSITIVE FORM (`=== "standard"`, never `!== "link"`), for the reason the
 * server twin spells out: the negative spelling would admit every kind added to
 * the union later, silently, into the one place this predicate exists to keep
 * kinds out of. ⚠ HAND-MIRRORED from `src/features/workspaces/types.ts ›
 * isStandardWorkspace` — F-295 is the standing entry on this duplication; edit
 * that one and copy it down.
 */
function isStandardWorkspace(workspace) {
    return (workspace.kind ?? "standard") === "standard";
}
