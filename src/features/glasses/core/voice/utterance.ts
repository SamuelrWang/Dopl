import { nowOf, sleepOf, type Clock } from "../clock";
import type { ChannelLink } from "../devices/service";
import { utf8Bytes } from "../validation";

/**
 * Voice → channel: what the wearer said is posted into the target channel as
 * the device owner's own message, so the channel's normal wake rule wakes its
 * agent, then holds briefly for the agent's first reply. The hold is CAPPED
 * (`GLASSES_REPLY_HOLD_MS`, default 6000) and its clock starts BEFORE the post,
 * so post + hold stays under the ~10s a glasses client waits. A slower reply
 * still reaches the glasses through the inbox's reply mirror.
 * Pure over a {@link ChannelGateway}; the real one is `channel-gateway.ts`.
 */

export interface ChannelReply {
  id: string;
  seq: number;
  body: string;
  agentName: string;
  /** The agent that wrote it (`channel_sessions.name`), when the row says. */
  agentId?: string | null;
}

export interface PostedUtterance {
  id: string;
  seq: number;
  /** Agent ids the server's wake verdict addressed (empty = woke nobody). */
  recipientAgentIds: string[];
  /** Live agent sessions in the channel at post time. */
  liveAgents: number;
  /** The agent the post was @-addressed to (`agent-<id>`), or null for an unaddressed post. */
  addressedTo: string | null;
  /** That agent's operator-given display name, when it has one. */
  addressedName: string | null;
  channelName: string;
}

export interface ChannelGateway {
  /** Post as the operator; `agentId` @-addresses that live agent (else the post is unaddressed).
   *  Throws {@link UtteranceError} when the addressed agent is not running. */
  postAsOperator(channel: ChannelLink, operatorUserId: string, text: string, agentId: string | null): Promise<PostedUtterance>;
  /** Agent-authored `message` rows after `seq`, oldest first. */
  agentMessagesAfter(channelId: string, seq: number, limit: number): Promise<ChannelReply[]>;
  /** The channel's current highest seq (0 when empty). */
  headSeq(channelId: string): Promise<number>;
}

interface VoiceConfig {
  channel: ChannelLink;
  /** The account the utterance is posted as: the device owner, a member of the channel. */
  operatorUserId: string;
  /** Agent to @-address, or null for an unaddressed channel post. */
  agentId: string | null;
}

export interface UtteranceDeps extends Clock {
  gateway: ChannelGateway;
  config: VoiceConfig;
  /** Overrides {@link replyHoldMsFromEnv}. */
  holdMs?: number;
}

const DEFAULT_REPLY_HOLD_MS = 6000;
/** Never hold longer, whatever the env says: a glasses client gives up at ~10s, and posting takes time too. */
const MAX_REPLY_HOLD_MS = 6000;
const POLL_MS = 500;
const UTTERANCE_MAX_BYTES = 4000;

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
  channel_name?: string;
  /** Set when `replied`: the reply text, its channel message id (the mirrored
   *  card is `reply-<reply_message_id>`, so the plugin can skip it) and the agent's name. */
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

export async function handleGlassesUtterance(deps: UtteranceDeps, text: string): Promise<UtteranceResult> {
  const clean = text.trim();
  if (!clean) throw new UtteranceError("nothing to send");
  if (utf8Bytes(clean) > UTTERANCE_MAX_BYTES) {
    throw new UtteranceError(`utterance is too long (max ${UTTERANCE_MAX_BYTES} bytes)`);
  }
  const { gateway, config } = deps;
  const sleep = sleepOf(deps);
  // The budget covers the post too, so a slow write eats the hold, not the client's timeout.
  const deadline = nowOf(deps) + (deps.holdMs ?? replyHoldMsFromEnv());
  const posted = await gateway.postAsOperator(config.channel, config.operatorUserId, clean, config.agentId);
  const base = {
    channel_message_id: posted.id,
    addressed_to: posted.addressedTo,
    addressed_name: posted.addressedName,
    channel_name: posted.channelName,
  };
  if (posted.liveAgents === 0 && posted.recipientAgentIds.length === 0) {
    return { status: "offline", ...base };
  }
  while (nowOf(deps) + POLL_MS <= deadline) {
    await sleep(POLL_MS);
    const [reply] = await gateway.agentMessagesAfter(config.channel.channelId, posted.seq, 1);
    if (reply) {
      return { status: "replied", ...base, reply: reply.body, reply_message_id: reply.id, agent: reply.agentName };
    }
  }
  return { status: "sent", ...base };
}
