import { randomUUID } from "node:crypto";
import { HttpError } from "@/shared/lib/http-error";
import { AGENT_MODELS, agentModelLabel } from "@/features/channels/lib/agent-models";
import type { ChannelLinker } from "./devices-service";
import type { DeviceStore, GlassesDevice } from "./devices-types";
import { flattenForG2 } from "./g2-text";
import type { AgentStatus, LaunchState, MenuGateway, MenuMessage, MenuSession } from "./menu-types";
import { sanitizeGlassesText } from "./text";
import { AGENT_ID_RE } from "./voice-target";

/**
 * The glasses menu + read mode (docs/glasses-mcp.md › Menu), pure over a
 * {@link MenuGateway}. 🔒 Every channel-scoped call first asks the linker
 * whether the device OWNER may still see the channel (member of a live channel)
 * — the same rule as linking and the reply mirror, so departure is removal —
 * and the gateway's channels-service calls re-check on their own.
 */

export interface MenuDeps {
  gateway: MenuGateway;
  linker: ChannelLinker;
  devices: DeviceStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type Device = Pick<GlassesDevice, "id" | "user_id">;

export const RECENT_AGENTS = 6;
export const PAGE_DEFAULT = 40;
export const PAGE_MAX = 100;
export const POLL_MAX_SEC = 20;
export const LAUNCH_HOLD_MS = 10_000;
const LAUNCH_POLL_MS = 1500;
const NAME_MAX = 40;
const RUNTIME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const RUNTIME_LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

const notFound = () => new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found.");
const iso = (ms: number) => new Date(ms).toISOString();
const clean = (s: string | null | undefined, fallback: string) =>
  (sanitizeGlassesText(s ?? "") || fallback).slice(0, NAME_MAX);

async function assertReadable(deps: MenuDeps, device: Device, channelId: string): Promise<void> {
  if (!(await deps.linker.isLinkable(device.user_id, channelId))) throw notFound();
}

export function agentStatus(s: Pick<MenuSession, "state" | "detail">): AgentStatus {
  if (s.state === "ended") return "ended";
  if (s.detail === "permission" || s.detail === "awaiting_inbound") return "waiting";
  return s.state === "working" ? "working" : "idle";
}

const agentName = (s: Pick<MenuSession, "agentId" | "displayName">) => clean(s.displayName, `agent-${s.agentId}`);
export const runtimeLabel = (id: string) => RUNTIME_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

// ─── Home + agents ──────────────────────────────────────────────────────────

export async function menuHome(deps: MenuDeps, device: Device) {
  const channels = (await deps.gateway.listChannels(device.user_id)).sort((a, b) =>
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
  const names = new Map(channels.map((c) => [c.id, c.name]));
  const sessions = await deps.gateway.listSessions(
    channels.map((c) => c.id),
    RECENT_AGENTS,
  );
  return {
    recent_agents: sessions.map((s) => ({
      session_id: s.agentId,
      agent_name: agentName(s),
      channel: { id: s.channelId, name: clean(names.get(s.channelId), "Channel") },
      status: agentStatus(s),
      last_activity: s.lastActivity,
    })),
    channels: channels.map((c) => ({
      id: c.id,
      name: clean(c.name, "Channel"),
      container_name: clean(c.containerName, ""),
      last_activity: c.lastActivity,
      unread: c.unread,
    })),
  };
}

export async function channelAgents(deps: MenuDeps, device: Device, channelId: string) {
  await assertReadable(deps, device, channelId);
  const sessions = await deps.gateway.listSessions([channelId], 50);
  const runtimes = await deps.gateway.runtimesFor(sessions.map((s) => s.agentId));
  return {
    agents: sessions.map((s) => ({
      session_id: s.agentId,
      name: agentName(s),
      runtime: runtimes.get(s.agentId) ?? null,
      model: s.model,
      status: agentStatus(s),
      last_activity: s.lastActivity,
    })),
  };
}

// ─── Read mode + conversation ───────────────────────────────────────────────

export interface G2Message {
  seq: number;
  author: { kind: "member" | "agent"; name: string };
  text: string;
  created_at: string;
  attachments_note?: string;
}

/** The owner's own posts addressed to `agent`, and `agent`'s own posts. */
function inConversation(m: MenuMessage, ownerId: string, agent: string): boolean {
  if (m.authorKind === "agent") return m.authorAgentId === agent;
  return m.authorUserId === ownerId && m.recipientAgentIds.includes(agent);
}

export function toG2Message(m: MenuMessage, ownerId: string): G2Message {
  const { text, notes } = flattenForG2(m.body);
  const author: G2Message["author"] =
    m.authorKind === "agent"
      ? { kind: "agent", name: clean(m.authorAgentName, m.authorAgentId ? `agent-${m.authorAgentId}` : "Agent") }
      : { kind: "member", name: m.authorUserId === ownerId ? "You" : clean(m.authorName, m.authorKind === "system" ? "Dopl" : "Member") };
  return {
    seq: m.seq,
    author,
    text,
    created_at: m.createdAt,
    ...(notes.length ? { attachments_note: notes.join(" ") } : {}),
  };
}

function shape(messages: MenuMessage[], ownerId: string, agent: string | null): G2Message[] {
  return messages
    .filter((m) => m.kind === "message")
    .filter((m) => !agent || inConversation(m, ownerId, agent))
    .sort((a, b) => a.seq - b.seq)
    .map((m) => toG2Message(m, ownerId));
}

export interface ReadQuery {
  before?: number;
  limit?: number;
  agent?: string | null;
}

export async function readChannel(deps: MenuDeps, device: Device, channelId: string, q: ReadQuery) {
  await assertReadable(deps, device, channelId);
  const limit = Math.min(Math.max(q.limit ?? PAGE_DEFAULT, 1), PAGE_MAX);
  const agent = q.agent ?? null;
  // A conversation keeps a fraction of the room's rows, so it reads a wider raw page.
  const raw = await deps.gateway.readMessages(device.user_id, channelId, {
    before: q.before,
    limit: agent ? Math.min(limit * 4, 200) : limit,
  });
  const messages = shape(raw.messages, device.user_id, agent).slice(-limit);
  const oldest = raw.messages.reduce((min, m) => Math.min(min, m.seq), Number.POSITIVE_INFINITY);
  return {
    messages,
    has_more: raw.hasMore,
    /** Pass as `before` for the next older page (covers rows the filters dropped). */
    before: Number.isFinite(oldest) ? oldest : null,
    /** Pass as `after` to long-poll for newer messages. */
    after: raw.messages.reduce((max, m) => Math.max(max, m.seq), 0),
  };
}

export async function pollChannel(
  deps: MenuDeps,
  device: Device,
  channelId: string,
  q: { after: number; waitSec: number; agent?: string | null },
  signal?: AbortSignal,
) {
  await assertReadable(deps, device, channelId);
  const now = (deps.now ?? Date.now)();
  const deadline = now + Math.min(Math.max(q.waitSec, 0), POLL_MAX_SEC) * 1000;
  const raw = await deps.gateway.awaitMessages(device.user_id, channelId, q.after, deadline, signal);
  return {
    messages: shape(raw, device.user_id, q.agent ?? null),
    has_more: false,
    after: raw.reduce((max, m) => Math.max(max, m.seq), q.after),
  };
}

// ─── Launch ─────────────────────────────────────────────────────────────────

export async function launchOptions(deps: MenuDeps, device: Device, channelId: string) {
  await assertReadable(deps, device, channelId);
  const history = await deps.gateway.launchHistory(device.user_id);
  const order = [...new Set([...history.map((h) => h.runtime), "claude"])].filter((r) => RUNTIME_RE.test(r));
  return {
    runtimes: order.map((runtime) => {
      const seen = history.filter((h) => h.runtime === runtime && h.model).map((h) => h.model as string);
      const known = runtime === "claude" ? AGENT_MODELS.map((m) => m.id) : [];
      const ids = [...new Set([...seen, ...known])];
      return {
        id: runtime,
        label: runtimeLabel(runtime),
        models: [
          { id: "", label: "Default" },
          ...ids.map((id) => ({ id, label: clean(runtime === "claude" ? agentModelLabel(id) : id, id) })),
        ],
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

export async function launchAgent(
  deps: MenuDeps,
  device: Device,
  input: { channel_id: string; runtime: string; model?: string | null },
) {
  const runtime = input.runtime.trim();
  if (!RUNTIME_RE.test(runtime)) throw new HttpError(400, "BAD_RUNTIME", "Unknown runtime.");
  const model = input.model?.trim() || null;
  if (model && (model.length > 100 || /\s/.test(model))) throw new HttpError(400, "BAD_MODEL", "Unknown model.");
  await assertReadable(deps, device, input.channel_id);
  const shortModel = model ? (runtime === "claude" ? agentModelLabel(model).split(" ")[0] : model) : "";
  const agentName = `${runtimeLabel(runtime)}${shortModel ? ` ${shortModel}` : ""}`.slice(0, 60);
  const filed = await deps.gateway.createLaunch(device.user_id, input.channel_id, {
    runtime,
    model,
    agentName,
    clientMsgId: `glasses-launch-${randomUUID()}`,
  });
  if (!filed) throw new HttpError(409, "DESKTOP_OFFLINE", "Open Dopl on your computer to start agents.");
  const state = await holdLaunch(deps, device, input.channel_id, filed);
  return finishLaunch(deps, device, input.channel_id, state);
}

async function holdLaunch(deps: MenuDeps, device: Device, channelId: string, state: LaunchState): Promise<LaunchState> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + LAUNCH_HOLD_MS;
  let current = state;
  while (current.status === "launching" && now() + LAUNCH_POLL_MS <= deadline) {
    await sleep(LAUNCH_POLL_MS);
    current = await deps.gateway.getLaunch(device.user_id, channelId, current.directiveId);
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
    await deps.devices.setCurrentTarget(device.id, channelId, state.agentId, iso((deps.now ?? Date.now)()));
  }
  return {
    status: state.status,
    session_id: state.agentId,
    agent_name: clean(state.agentName, state.agentId ? `agent-${state.agentId}` : "New agent"),
    directive_id: state.directiveId,
  };
}

/** Re-check a launch that was still `launching` when {@link launchAgent} returned. */
export async function launchStatus(deps: MenuDeps, device: Device, channelId: string, directiveId: string) {
  await assertReadable(deps, device, channelId);
  return finishLaunch(deps, device, channelId, await deps.gateway.getLaunch(device.user_id, channelId, directiveId));
}

// ─── Current target ─────────────────────────────────────────────────────────

export async function setTarget(
  deps: MenuDeps,
  device: Device,
  input: { channel_id: string | null; agent_session_id?: string | null },
) {
  const agent = input.agent_session_id ?? null;
  if (agent !== null && !AGENT_ID_RE.test(agent)) throw new HttpError(400, "BAD_AGENT", "Unknown agent.");
  if (input.channel_id !== null) await assertReadable(deps, device, input.channel_id);
  await deps.devices.setCurrentTarget(device.id, input.channel_id, input.channel_id ? agent : null, iso((deps.now ?? Date.now)()));
  return { ok: true as const };
}
