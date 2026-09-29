/**
 * **WHICH DEVICE A MEMBER WROTE FROM, AS AN AGENT READS IT** — the server-stamped
 * `metadata.source` (docs/specs/device-aware-messages.md) rendered as one compact tag,
 * plus ONE guidance line when the member is on glasses.
 *
 * ⚠ `GLASSES_REPLY_GUIDANCE` IS THE ONE COPY. The desktop feeds its sessions the same line
 * (`dopl-desktop-app/main/message-source.js`), which a desktop test holds byte-equal to this.
 * ⚠ SAID ONCE PER PAGE, never per message: MCP payload size is a budget (`tool-budget.test.ts`).
 */
import type { ChannelMessage } from "@dopl/client";
export declare const GLASSES_REPLY_GUIDANCE: string;
/** ` · via glasses (`Even G2`)`, ` · via web`, or "" for a missing / unreadable stamp. */
export declare function viaTag(raw: unknown): string;
/** {@link viaTag} for one transcript line; "" on an agent line. */
export declare const sourceTag: (m: ChannelMessage) => string;
/** The guidance line when the NEWEST member line on the page came from glasses, else null. */
export declare function sourceGuidance(messages: readonly ChannelMessage[]): string | null;
