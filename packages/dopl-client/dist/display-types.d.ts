/**
 * The `display` field of a channel post (docs/specs/device-aware-messages.md): an agent-built
 * display in the glasses block vocabulary, stored as reserved `metadata.display` with a server
 * screen id. `body` is its plain-text fallback. Its own module for `escalation-types.ts`'s reason:
 * `channel-types.ts` is at the 500-line cap.
 */
export interface ChannelDisplayFields {
    display?: {
        blocks: Record<string, unknown>[];
        layout?: "stack" | "absolute";
        wait_for_input?: boolean;
    };
}
