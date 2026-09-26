/**
 * Voice → channel: what the wearer said is posted into the device's LINKED Dopl
 * channel as the device owner's own message, so the channel's normal wake rule wakes its
 * agent, then holds briefly for the agent's first reply. The hold is CAPPED
 * (`GLASSES_REPLY_HOLD_MS`, default 6000) and its clock starts BEFORE the post,
 * so post + hold stays under the ~10s an Even client waits. A reply slower than
 * that still reaches the glasses through the inbox's reply mirror (`reply-mirror.ts`).
 * Pure over a {@link ChannelGateway}; the real one is `voice-channel.ts`.
 */

export interface ChannelReply {
  id: string;
  seq: number;
  body: string;
  agentName: string;
}

export interface PostedUtterance {
  id: string;
  seq: number;
  /** Agent ids the server's wake verdict addressed (empty = woke nobody). */
  recipientAgentIds: string[];
  /** Live agent sessions in the channel at post time. */
  liveAgents: number;
  /** The one agent the post was @-addressed to, if exactly one was live. */
  addressedTo: string | null;
  /** That agent's operator-given display name, when it has one. */
  addressedName: string | null;
}

export interface ChannelGateway {
  postAsOperator(channelId: string, operatorUserId: string, text: string): Promise<PostedUtterance>;
  /** Agent-authored `message` rows after `seq`, oldest first. */
  agentMessagesAfter(channelId: string, seq: number, limit: number): Promise<ChannelReply[]>;
  /** The channel's current highest seq (0 when empty). */
  headSeq(channelId: string): Promise<number>;
}

export interface VoiceConfig {
  channelId: string;
  /** The account the utterance is posted as: the device owner, a member of the linked channel. */
  operatorUserId: string;
}

export interface UtteranceDeps {
  gateway: ChannelGateway;
  config: VoiceConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides {@link replyHoldMsFromEnv}. */
  holdMs?: number;
}

export const DEFAULT_REPLY_HOLD_MS = 6000;
/** Never hold longer than this, whatever the env says: an Even client gives up at ~10s, and posting takes time too. */
const MAX_REPLY_HOLD_MS = 6000;
const POLL_MS = 500;
export const UTTERANCE_MAX_BYTES = 4000;

export function replyHoldMsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.GLASSES_REPLY_HOLD_MS);
  if (env.GLASSES_REPLY_HOLD_MS === undefined || !Number.isFinite(n) || n < 0) return DEFAULT_REPLY_HOLD_MS;
  return Math.min(n, MAX_REPLY_HOLD_MS);
}

export interface UtteranceResult {
  status: "sent" | "offline" | "replied";
  channel_message_id: string;
  /** `@`-less handle of the one agent addressed, else null. */
  addressed_to: string | null;
  /** That agent's display name (e.g. "Orchestrator"), else null. */
  addressed_name?: string | null;
  /** Set when `replied`: the agent's reply text, its channel message id (the
   *  mirrored card is `reply-<reply_message_id>`, so the plugin can skip it) and
   *  the agent's name. */
  reply?: string;
  reply_message_id?: string;
  agent?: string;
}

export class UtteranceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UtteranceError";
  }
}

/** Where a device's voice goes: its linked channel, posted as the device's owner. Null when unlinked. */
export function voiceConfigForDevice(device: {
  user_id: string;
  linked_channel_id: string | null;
}): VoiceConfig | null {
  return device.linked_channel_id ? { channelId: device.linked_channel_id, operatorUserId: device.user_id } : null;
}

export async function handleGlassesUtterance(deps: UtteranceDeps, text: string): Promise<UtteranceResult> {
  const clean = text.trim();
  if (!clean) throw new UtteranceError("nothing to send");
  if (new TextEncoder().encode(clean).length > UTTERANCE_MAX_BYTES) {
    throw new UtteranceError(`utterance is too long (max ${UTTERANCE_MAX_BYTES} bytes)`);
  }
  const { gateway, config } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // The budget covers the post too, so a slow write eats the hold, not the client's timeout.
  const deadline = now() + (deps.holdMs ?? replyHoldMsFromEnv());
  const posted = await gateway.postAsOperator(config.channelId, config.operatorUserId, clean);
  const base = {
    channel_message_id: posted.id,
    addressed_to: posted.addressedTo,
    addressed_name: posted.addressedName,
  };
  if (posted.liveAgents === 0 && posted.recipientAgentIds.length === 0) {
    return { status: "offline", ...base };
  }
  while (now() + POLL_MS <= deadline) {
    await sleep(POLL_MS);
    const [reply] = await gateway.agentMessagesAfter(config.channelId, posted.seq, 1);
    if (reply) {
      return { status: "replied", ...base, reply: reply.body, reply_message_id: reply.id, agent: reply.agentName };
    }
  }
  return { status: "sent", ...base };
}
