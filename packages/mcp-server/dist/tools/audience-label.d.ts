/**
 * "Who can see this row" labels, one table for both list surfaces. The label comes from the row's group/container,
 * never the visibility column: a home-channel base is stored `private` yet shared, and a `workspace` identity there means the room.
 */
export declare const AUDIENCE_LABELS: {
    readonly you: "only you";
    readonly channel: "everyone in this channel";
    /** `public` base / `workspace` identity in a standard workspace. */
    readonly workspace: "every member of this workspace";
    /** F-735's orphans: reachable from no surface in the app. */
    readonly nobody: "nobody — not reachable in the app";
};
export type AudienceLabel = (typeof AUDIENCE_LABELS)[keyof typeof AUDIENCE_LABELS];
