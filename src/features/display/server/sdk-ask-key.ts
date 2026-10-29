import { DISPLAY_ID_RE } from "../core/types";

/**
 * The idempotency key of the Dopl app's own SDK ask (W1.2 gap #3) carries its CHANNEL LINK, the way a
 * prosumer lens row carries `channel_message_id`: the glasses' answer route reads it off the settled
 * action and posts the lens answer to that decision (`answer.ts › answerFromSdkLens`), so no function
 * has to stay alive waiting for the wearer.
 *
 *   `dsk1.<channel uuid>.<nonce>.<display id>`   an ask whose decision posts in that channel
 *   `display-<display id>-<nonce>`               anything else (no channel decision to answer)
 *
 * The decision's envelope records the exact key (`DisplayEnvelopeV2.sdk_ask_key`), so an answer to an
 * older ask on a display since replaced in place is recognised and dropped. ≤ 5+36+1+64+1+64 = 171
 * chars, inside the contract's 255.
 */

const LINKED = /^dsk1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{1,64})\.(.+)$/;

export function sdkAskKey(a: { channelId: string | null; displayId: string; nonce: string }): string {
  return a.channelId ? `dsk1.${a.channelId}.${a.nonce}.${a.displayId}` : `display-${a.displayId}-${a.nonce}`;
}

/** The channel link in a key {@link sdkAskKey} made, or null (any other key, any other caller). */
export function parseSdkAskKey(key: string): { channelId: string; displayId: string } | null {
  const m = LINKED.exec(key);
  if (!m || !DISPLAY_ID_RE.test(m[3])) return null;
  return { channelId: m[1], displayId: m[3] };
}
