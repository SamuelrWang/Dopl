/**
 * Voice → channel: what the wearer said is posted into the LINKED Dopl channel
 * as the operator's own message, so the channel's normal wake rule wakes its
 * agent. Then a short hold for the agent's first reply. Pure over a
 * {@link ChannelGateway}; the real one is `voice-channel.ts`.
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
  /** The account the utterance is posted as: a member of the linked channel. */
  operatorUserId: string;
}

export interface UtteranceDeps {
  gateway: ChannelGateway;
  config: VoiceConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  holdMs?: number;
}

export const UTTERANCE_HOLD_MS = 8000;
const POLL_MS = 1000;
export const UTTERANCE_MAX_BYTES = 4000;

export type UtteranceResult =
  | { status: "replied"; channel_message_id: string; reply: string; reply_message_id: string; agent: string }
  | { status: "sent" | "offline"; channel_message_id: string; addressed_to: string | null };

export class UtteranceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UtteranceError";
  }
}

export function voiceConfigFromEnv(env: Record<string, string | undefined> = process.env): VoiceConfig | null {
  const channelId = env.GLASSES_LINKED_CHANNEL_ID?.trim();
  const operatorUserId = (env.GLASSES_LINKED_CHANNEL_USER_ID ?? env.GLASSES_DEVICE_USER_ID)?.trim();
  return channelId && operatorUserId ? { channelId, operatorUserId } : null;
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
  const posted = await gateway.postAsOperator(config.channelId, config.operatorUserId, clean);
  const base = { channel_message_id: posted.id, addressed_to: posted.addressedTo };
  if (posted.liveAgents === 0 && posted.recipientAgentIds.length === 0) {
    return { status: "offline", ...base };
  }
  const start = now();
  const holdMs = deps.holdMs ?? UTTERANCE_HOLD_MS;
  while (now() - start < holdMs) {
    await sleep(POLL_MS);
    const [reply] = await gateway.agentMessagesAfter(config.channelId, posted.seq, 1);
    if (reply) {
      return {
        status: "replied",
        channel_message_id: posted.id,
        reply: reply.body,
        reply_message_id: reply.id,
        agent: reply.agentName,
      };
    }
  }
  return { status: "sent", ...base };
}
