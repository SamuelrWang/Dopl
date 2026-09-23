"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIENCE_LABELS = void 0;
/**
 * "Who can see this row" labels, one table for both list surfaces. The label comes from the row's group/container,
 * never the visibility column: a home-channel base is stored `private` yet shared, and a `workspace` identity there means the room.
 */
exports.AUDIENCE_LABELS = {
    you: "only you",
    channel: "everyone in this channel",
    /** `public` base / `workspace` identity in a standard workspace. */
    workspace: "every member of this workspace",
    /** F-735's orphans: reachable from no surface in the app. */
    nobody: "nobody — not reachable in the app",
};
