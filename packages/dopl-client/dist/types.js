"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStandardWorkspace = isStandardWorkspace;
/** Shared kind predicate — every LISTING filters through this, no resolution does. */
function isStandardWorkspace(workspace) {
    return (workspace.kind ?? "standard") !== "link";
}
