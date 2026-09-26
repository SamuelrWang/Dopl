/**
 * Voice → channel: what the wearer said is posted into the LINKED Dopl channel
 * as the operator's own message, so the channel's normal wake rule wakes its
 * agent, and returns AT ONCE. There is no reply hold (Samuel, 2026-09-26: agent
 * replies almost always take longer than the ~10s an Even client waits); the
 * reply reaches the glasses through the inbox's reply mirror (`reply-mirror.ts`).
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
  /** The account the utterance is posted as: a member of the linked channel. */
  operatorUserId: string;
}

export interface UtteranceDeps {
  gateway: ChannelGateway;
  config: VoiceConfig;
}

export const UTTERANCE_MAX_BYTES = 4000;

export interface UtteranceResult {
  /** `replied` is no longer produced (no reply hold); kept in the union for older clients. */
  status: "sent" | "offline" | "replied";
  channel_message_id: string;
  /** `@`-less handle of the one agent addressed, else null. */
  addressed_to: string | null;
  /** That agent's display name (e.g. "Orchestrator"), else null. */
  addressed_name?: string | null;
  /** Compat only: never set on the hot path. */
  reply?: string;
  reply_message_id?: string;
}

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
  const posted = await gateway.postAsOperator(config.channelId, config.operatorUserId, clean);
  const offline = posted.liveAgents === 0 && posted.recipientAgentIds.length === 0;
  return {
    status: offline ? "offline" : "sent",
    channel_message_id: posted.id,
    addressed_to: posted.addressedTo,
    addressed_name: posted.addressedName,
  };
}
