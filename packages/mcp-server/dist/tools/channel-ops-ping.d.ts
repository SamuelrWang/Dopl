import type { DoplClient, PingKind } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * SEND ONE PING.
 *
 * The canonical write-op order — pre-call refusals, resolve, call, classify 4xx,
 * render — and the body cap is checked BEFORE any round-trip so "nothing was
 * sent" is trivially true rather than confusable with a delivery failure.
 */
export declare function opPing(client: DoplClient, channelRef: string, kind: PingKind, body: string, 
/** WHO has to act — `"desktop"`, `@agent-<id>`, or a member ref. */
recipientRef: string, thread?: string): Promise<ToolResponse>;
/**
 * READ THE INBOX — what was sent TO ME.
 *
 * 🔒 RECIPIENT-SCOPED AT THE SERVER, and there is deliberately no argument for
 * whose inbox: a ping targets one person, and a read that could answer for
 * somebody else would make the whole surface a worse transcript.
 */
export declare function opReadPings(client: DoplClient, opts?: {
    limit?: number;
}): Promise<ToolResponse>;
