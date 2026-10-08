import { randomUUID } from "node:crypto";
import { HttpError } from "@/shared/lib/http-error";
import { glassesMessageSource } from "@/features/channels/server/message-source-stamp";
import { glassesPlatform } from "../../platforms/registry";
import type { GlassesPlatform } from "../../platforms/types";
import { flattenChannelText } from "../channel-text";
import { iso, nowOf, sleepOf, type Clock } from "../clock";
import { linkOf, type ChannelLink, type ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice } from "../devices/types";
import { cleanName, type Sanitize } from "../validation";
import { AGENT_ID_RE } from "../voice/target";
import { activityVersion, channelActivity } from "./activity";
import { launchModels } from "./launch-models";
import { lensDisplay, type LensDisplay } from "./lens-display";
import type {
  AgentStatus,
  DisplayAnswerInput,
  LaunchState,
  MenuChannelHandle,
  MenuGateway,
  MenuMessage,
  MenuSession,
} from "./types";

/**
 * The glasses menu + read mode (docs/glasses-mcp.md › Menu), pure over a
 * {@link MenuGateway}. 🔒 Every channel-scoped call first asks the linker
 * whether the device OWNER may still see the channel (member of a live
 * channel), the same rule as linking and the reply mirror, so departure is
 * removal; the gateway's channels-service calls re-check on their own.
 */

export interface MenuDeps extends Clock {
  gateway: MenuGateway;
  linker: ChannelLinker;
  devices: DeviceStore;
}

type Device = Pick<GlassesDevice, "id" | "user_id" | "platform"> & Partial<Pick<GlassesDevice, "name">>;

const RECENT_AGENTS = 6;
const PAGE_DEFAULT = 40;
export const PAGE_MAX = 100;
export const POLL_MAX_SEC = 20;
const LAUNCH_HOLD_MS = 10_000;
const LAUNCH_POLL_MS = 1500;
/** Each hold slice: one message wait, then one activity read. */
const POLL_SLICE_MS = 2000;
const RUNTIME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const RUNTIME_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

const notFound = () => new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found.");
const platformOf = (device: Device): GlassesPlatform => glassesPlatform(device.platform);
const sanitizerOf = (device: Device): Sanitize => platformOf(device).sanitizeText;

/**
 * Sessions whose row carries no name get the persisted one (the run's last label, else its launch
 * name): one batched read for the whole list.
 */
async function namedSessions(deps: MenuDeps, sessions: MenuSession[]): Promise<MenuSession[]> {
  const unnamed = sessions.filter((s) => !s.displayName?.trim());
  if (unnamed.length === 0) return sessions;
  const names = await deps.gateway.persistedAgentNames(
    [...new Set(unnamed.map((s) => s.channelId))],
    unnamed.map((s) => s.agentId),
  );
  return sessions.map((s) => (s.displayName?.trim() ? s : { ...s, displayName: names.get(s.agentId) ?? null }));
}

/**
 * Agent-authored rows the page could not name (no live session row: the agent ended, or its Mac
 * restarted) get the persisted name, in ONE read per page. `agent-<id>` stays the last resort.
 */
async function namedMessages(deps: MenuDeps, channelId: string, messages: MenuMessage[]): Promise<MenuMessage[]> {
  const missing = messages.filter((m) => m.authorKind === "agent" && m.authorAgentId && !m.authorAgentName?.trim());
  if (missing.length === 0) return messages;
  const names = await deps.gateway.persistedAgentNames(
    [channelId],
    missing.map((m) => m.authorAgentId as string),
  );
  if (names.size === 0) return messages;
  return messages.map((m) =>
    m.authorAgentId && !m.authorAgentName?.trim() && names.has(m.authorAgentId) ? { ...m, authorAgentName: names.get(m.authorAgentId) ?? null } : m,
  );
}

async function assertReadable(deps: MenuDeps, device: Device, channelId: string): Promise<ChannelLink> {
  const link = await linkOf(deps.linker, device.user_id, channelId);
  if (!link) throw notFound();
  return link;
}

async function openReadable(deps: MenuDeps, device: Device, channelId: string): Promise<MenuChannelHandle> {
  return deps.gateway.openChannel(device.user_id, await assertReadable(deps, device, channelId));
}

export function agentStatus(s: Pick<MenuSession, "state" | "detail">): AgentStatus {
  if (s.state === "ended") return "ended";
  if (s.detail === "permission" || s.detail === "awaiting_inbound") return "waiting";
  return s.state === "working" ? "working" : "idle";
}

const agentName = (sanitize: Sanitize, s: Pick<MenuSession, "agentId" | "displayName">) =>
  cleanName(sanitize, s.displayName, `agent-${s.agentId}`);
const runtimeLabel = (id: string) => RUNTIME_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

export async function menuHome(deps: MenuDeps, device: Device) {
  const sanitize = sanitizerOf(device);
  const channels = (await deps.gateway.listChannels(device.user_id)).sort((a, b) =>
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
  const names = new Map(channels.map((c) => [c.id, c.name]));
  const sessions = await namedSessions(deps, await deps.gateway.listSessions(channels.map((c) => c.id), RECENT_AGENTS));
  return {
    recent_agents: sessions.map((s) => ({
      session_id: s.agentId,
      agent_name: agentName(sanitize, s),
      channel: { id: s.channelId, name: cleanName(sanitize, names.get(s.channelId), "Channel") },
      status: agentStatus(s),
      last_activity: s.lastActivity,
    })),
    channels: channels.map((c) => ({
      id: c.id,
      name: cleanName(sanitize, c.name, "Channel"),
      container_name: cleanName(sanitize, c.containerName, ""),
      last_activity: c.lastActivity,
      unread: c.unread,
    })),
  };
}

export async function channelAgents(deps: MenuDeps, device: Device, channelId: string) {
  await assertReadable(deps, device, channelId);
  const sessions = await namedSessions(deps, await deps.gateway.listSessions([channelId], 50));
  const runtimes = await deps.gateway.runtimesFor(sessions.map((s) => s.agentId));
  const sanitize = sanitizerOf(device);
  return {
    agents: sessions.map((s) => ({
      session_id: s.agentId,
      name: agentName(sanitize, s),
      runtime: runtimes.get(s.agentId) ?? null,
      model: s.model,
      status: agentStatus(s),
      last_activity: s.lastActivity,
    })),
  };
}

interface LensMessage {
  id: string;
  seq: number;
  author: { kind: "member" | "agent"; name: string };
  text: string;
  created_at: string;
  attachments_note?: string;
  /** The message's display (v2, v1 or a legacy decision), compiled for this device (`lens-display.ts`). */
  display?: LensDisplay;
  /** An answer message: the decision it answers (C3), so a loaded display page can mark it. */
  answer_to?: { message_id: string; index: number; choice: string };
}

/** The owner's own posts addressed to `agent`, and `agent`'s own posts. */
function inConversation(m: MenuMessage, ownerId: string, agent: string): boolean {
  if (m.authorKind === "agent") return m.authorAgentId === agent;
  return m.authorUserId === ownerId && m.recipientAgentIds.includes(agent);
}

export function toLensMessage(m: MenuMessage, ownerId: string, platform: GlassesPlatform): LensMessage {
  const sanitize = platform.sanitizeText;
  const shown = m.display ? lensDisplay(m.display, platform) : null;
  const { text, notes } = shown ? { text: shown.text, notes: [] as string[] } : flattenChannelText(m.body, sanitize);
  const author: LensMessage["author"] =
    m.authorKind === "agent"
      ? { kind: "agent", name: cleanName(sanitize, m.authorAgentName, m.authorAgentId ? `agent-${m.authorAgentId}` : "Agent") }
      : {
          kind: "member",
          name: m.authorUserId === ownerId ? "You" : cleanName(sanitize, m.authorName, m.authorKind === "system" ? "Dopl" : "Member"),
        };
  return {
    id: m.id,
    seq: m.seq,
    author,
    text,
    created_at: m.createdAt,
    ...(notes.length ? { attachments_note: notes.join(" ") } : {}),
    ...(shown ? { display: shown.display } : {}),
    ...(m.answerTo ? { answer_to: { ...m.answerTo, choice: sanitize(m.answerTo.choice) } } : {}),
  };
}

async function shape(deps: MenuDeps, channelId: string, messages: MenuMessage[], device: Device, agent: string | null): Promise<LensMessage[]> {
  const platform = platformOf(device);
  const kept = messages
    .filter((m) => m.kind === "message" && (!agent || inConversation(m, device.user_id, agent)))
    .sort((a, b) => a.seq - b.seq);
  return (await namedMessages(deps, channelId, kept)).map((m) => toLensMessage(m, device.user_id, platform));
}

interface ReadQuery {
  before?: number;
  limit?: number;
  agent?: string | null;
}

export async function readChannel(deps: MenuDeps, device: Device, channelId: string, q: ReadQuery) {
  const channel = await openReadable(deps, device, channelId);
  const limit = Math.min(Math.max(q.limit ?? PAGE_DEFAULT, 1), PAGE_MAX);
  const agent = q.agent ?? null;
  // A conversation keeps a fraction of the room's rows, so it reads a wider raw page.
  const [raw, live] = await Promise.all([
    channel.readMessages({ before: q.before, limit: agent ? Math.min(limit * 4, 200) : limit }),
    activityNow(deps, device, channelId),
  ]);
  const messages = (await shape(deps, channelId, raw.messages, device, agent)).slice(-limit);
  const oldest = raw.messages.reduce((min, m) => Math.min(min, m.seq), Number.POSITIVE_INFINITY);
  return {
    messages,
    has_more: raw.hasMore,
    /** Pass as `before` for the next older page (covers rows the filters dropped). */
    before: Number.isFinite(oldest) ? oldest : null,
    /** Pass as `after` to long-poll for newer messages. */
    after: raw.messages.reduce((max, m) => Math.max(max, m.seq), 0),
    ...live,
  };
}

/** Live agent activity in the channel, with its version (`activity.ts`). */
async function activityNow(deps: MenuDeps, device: Device, channelId: string) {
  const sessions = await deps.gateway.listSessions([channelId], 50);
  const activity = channelActivity(sessions, device.user_id, nowOf(deps), sanitizerOf(device));
  return { activity, activity_version: activityVersion(activity) };
}

/**
 * Long-poll: returns as soon as a message newer than `after` lands, or — when the
 * caller passes the `activity` version it holds — as soon as the channel's live
 * activity differs from it; else at the deadline.
 */
export async function pollChannel(
  deps: MenuDeps,
  device: Device,
  channelId: string,
  q: { after: number; waitSec: number; agent?: string | null; activity?: string | null },
  signal?: AbortSignal,
) {
  const channel = await openReadable(deps, device, channelId);
  const now = () => nowOf(deps);
  const deadline = now() + Math.min(Math.max(q.waitSec, 0), POLL_MAX_SEC) * 1000;
  const agent = q.agent ?? null;
  let after = q.after;
  let messages: LensMessage[] = [];
  let live = await activityNow(deps, device, channelId);
  const changed = () => !!q.activity && live.activity_version !== q.activity;
  while (!changed() && !signal?.aborted) {
    const slice = Math.min(now() + POLL_SLICE_MS, deadline);
    const raw = await channel.awaitMessages(after, slice, signal);
    // Rows the filters drop (other conversations, non-message kinds) still move the cursor,
    // but they do not end the hold: answering empty would send the client straight back.
    after = raw.reduce((max, m) => Math.max(max, m.seq), after);
    messages = await shape(deps, channelId, raw, device, agent);
    live = await activityNow(deps, device, channelId);
    if (messages.length > 0 || now() >= deadline) break;
    // A gateway that returned before its slice (tests, or an early wake) must not spin.
    if (now() < slice && deps.sleep) await deps.sleep(slice - now());
  }
  return { messages, has_more: false, after, ...live };
}

export async function launchOptions(deps: MenuDeps, device: Device, channelId: string) {
  const [, history, catalogs] = await Promise.all([
    assertReadable(deps, device, channelId),
    deps.gateway.launchHistory(device.user_id),
    // ⚠ A catalog read failure is never a menu failure: the lens falls back to history.
    deps.gateway.modelCatalogs(device.user_id).catch(() => []),
  ]);
  const sanitize = sanitizerOf(device);
  const order = [
    ...new Set([...catalogs.map((c) => c.runtime), ...history.map((h) => h.runtime), "claude"]),
  ].filter((r) => RUNTIME_RE.test(r));
  const now = nowOf(deps);
  return {
    runtimes: order.map((runtime) => {
      // The desktop's published roster where it has one (`launch-models.ts`); a pick the roster no
      // longer has is refused by the desktop as "no-model", never swapped.
      const ids = [...new Set(history.filter((h) => h.runtime === runtime && h.model).map((h) => h.model as string))];
      const { models, stale, note } = launchModels(runtime, catalogs, ids, now, (id, raw) =>
        cleanName(sanitize, raw, id)
      );
      return {
        id: runtime,
        label: runtimeLabel(runtime),
        models,
        stale,
        ...(note ? { note: cleanName(sanitize, note, note) } : {}),
      };
    }),
  };
}

const REFUSALS: Record<string, string> = {
  cap: "Agent limit reached on your computer.",
  busy: "Your computer is busy starting another agent. Try again.",
  "no-sdk": "That runtime isn't set up on your computer.",
  "no-model": "That model isn't available.",
  "auth-hold": "Sign in to that runtime on your computer first.",
  "no-bridge": "Dopl on your computer can't start agents right now.",
  "no-session": "Dopl on your computer isn't signed in.",
  "bad-name": "That agent name was refused.",
};

const LAUNCH_NAME_MAX = 40;

/** A wearer-typed agent name: sanitized for the display, ≤ 40 chars; empty → none. */
export function launchName(raw: string | null | undefined, sanitize: Sanitize): string | null {
  const name = sanitize(raw ?? "").slice(0, LAUNCH_NAME_MAX).trim();
  return name || null;
}

const NEW_AGENT_NAME = "New agent";

/** "New agent", then "New agent 1", "New agent 2"… — the first not already in `taken` (case-insensitive). */
export function nextFreeName(taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  if (!used.has(NEW_AGENT_NAME.toLowerCase())) return NEW_AGENT_NAME;
  for (let i = 1; ; i++) {
    const candidate = `${NEW_AGENT_NAME} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Unique among the owner's agents the menu can see (live sessions) and their recent launches. */
async function nextNewAgentName(deps: MenuDeps, device: Device): Promise<string> {
  // The launch history does not wait on the channel list the session read needs.
  const [sessions, launched] = await Promise.all([
    deps.gateway.listChannels(device.user_id).then((channels) =>
      deps.gateway.listSessions(channels.map((c) => c.id), 200)
    ),
    deps.gateway.recentLaunchNames(device.user_id),
  ]);
  return nextFreeName([...sessions.map((s) => s.displayName ?? ""), ...launched]);
}

export async function launchAgent(
  deps: MenuDeps,
  device: Device,
  input: { channel_id: string; runtime: string; model?: string | null; name?: string | null },
) {
  const runtime = input.runtime.trim();
  if (!RUNTIME_RE.test(runtime)) throw new HttpError(400, "BAD_RUNTIME", "Unknown runtime.");
  const model = input.model?.trim() || null;
  if (model && (model.length > 100 || /\s/.test(model))) throw new HttpError(400, "BAD_MODEL", "Unknown model.");
  const channel = await openReadable(deps, device, input.channel_id);
  // The name rides the launch's own `agentName` (the field `dopl_launch_agent` sends); the
  // desktop applies it or refuses `bad-name`. Unnamed launches get the next free "New agent N".
  const agentName = launchName(input.name, sanitizerOf(device)) ?? (await nextNewAgentName(deps, device));
  const filed = await channel.createLaunch({ runtime, model, agentName, clientMsgId: `glasses-launch-${randomUUID()}` });
  if (!filed) throw new HttpError(409, "DESKTOP_OFFLINE", "Open Dopl on your computer to start agents.");
  const state = await holdLaunch(deps, channel, filed);
  return finishLaunch(deps, device, input.channel_id, state);
}

async function holdLaunch(deps: MenuDeps, channel: MenuChannelHandle, state: LaunchState): Promise<LaunchState> {
  const sleep = sleepOf(deps);
  const deadline = nowOf(deps) + LAUNCH_HOLD_MS;
  let current = state;
  while (current.status === "launching" && nowOf(deps) + LAUNCH_POLL_MS <= deadline) {
    await sleep(LAUNCH_POLL_MS);
    current = await channel.getLaunch(current.directiveId);
  }
  return current;
}

async function finishLaunch(deps: MenuDeps, device: Device, channelId: string, state: LaunchState) {
  if (state.status === "refused") {
    const reason = state.refusalReason ?? "refused";
    throw new HttpError(409, `LAUNCH_${reason.toUpperCase().replace(/-/g, "_")}`, REFUSALS[reason] ?? "Your computer declined the launch.");
  }
  if (state.status === "expired") {
    throw new HttpError(409, "LAUNCH_EXPIRED", "Dopl on your computer didn't pick up the launch. Is it open?");
  }
  if (state.status === "launched" && state.agentId) {
    // Voice now goes to the new agent, as the wearer lands in its conversation.
    await deps.devices.setCurrentTarget(device.id, channelId, state.agentId, iso(nowOf(deps)));
  }
  return {
    status: state.status,
    session_id: state.agentId,
    agent_name: cleanName(sanitizerOf(device), state.agentName, state.agentId ? `agent-${state.agentId}` : NEW_AGENT_NAME),
    directive_id: state.directiveId,
  };
}

/** Re-check a launch that was still `launching` when {@link launchAgent} returned. */
export async function launchStatus(deps: MenuDeps, device: Device, channelId: string, directiveId: string) {
  const channel = await openReadable(deps, device, channelId);
  return finishLaunch(deps, device, channelId, await channel.getLaunch(directiveId));
}

export async function setTarget(
  deps: MenuDeps,
  device: Device,
  input: { channel_id: string | null; agent_session_id?: string | null },
) {
  const agent = input.agent_session_id ?? null;
  if (agent !== null && !AGENT_ID_RE.test(agent)) throw new HttpError(400, "BAD_AGENT", "Unknown agent.");
  if (input.channel_id !== null) await assertReadable(deps, device, input.channel_id);
  await deps.devices.setCurrentTarget(device.id, input.channel_id, input.channel_id ? agent : null, iso(nowOf(deps)));
  return { ok: true as const };
}

/**
 * `POST /channels/:id/messages/:messageId/display/answer` from the glasses: the app's own answer
 * path (`display/server/answer.ts › answerDisplay`: membership, answerers, the decision lane), as
 * the device owner, with `via: "glasses"`.
 */
export async function answerChannelDisplay(
  deps: MenuDeps,
  device: Device,
  channelId: string,
  messageId: string,
  input: DisplayAnswerInput,
) {
  const channel = await openReadable(deps, device, channelId);
  const source = glassesMessageSource({ id: device.id, name: device.name ?? "", platform: device.platform });
  const { answer } = await channel.answerDisplay(messageId, input, source);
  return { ok: true as const, answer };
}
