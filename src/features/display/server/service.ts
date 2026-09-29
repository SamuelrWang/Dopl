import "server-only";
import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { sessionChannelId } from "@/shared/auth/session-header";
import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel, type ChannelContext } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import { ChannelNotFoundError } from "@/features/channels/server/errors";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelRow } from "@/features/channels/server/dto";
import { memberHandlesOf, mentionedUserIdsOf } from "@/features/channels/lib/mentions";
import { fetchProfiles } from "@/features/channels/server/repository-workspace";
import { iso, nowOf, sleepOf } from "@/features/glasses/core/clock";
import { deviceRepository } from "@/features/glasses/core/devices/repository";
import { glassesRepository } from "@/features/glasses/core/messages/repository";
import { ASK_HOLD_CAP_SEC, platformOf, type GlassesDeps } from "@/features/glasses/core/messages/service";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { decisionIndexOf, displayOf } from "../core/adapt";
import { degradeLabel } from "../core/degrade";
import { displayFallback, firstTextLine } from "../core/fallback";
import { normalizeDisplay } from "../core/normalize";
import { checkTemplateSpec, cleanTemplateName, fillTemplate, templateSpecOf, templateVariables } from "../core/template";
import {
  DISPLAY_ID_RE,
  choiceOf,
  newDisplayId,
  type ChoiceBlock,
  type DisplayAnswerStamp,
  type DisplayBlock,
  type DisplayEnvelopeV2,
  type DisplayLayout,
  type DisplayOrigin,
  type Positioned,
} from "../core/types";
import { compileForLens, isReservedLensId, lensState, pushAsk, pushScreen } from "./lens";
import { channelWorkspaceOf, findByDisplayId, hasAnswerMessage, replaceDisplay } from "./repository";

/**
 * **`showDisplay` — THE ONE DOOR** (`POST /api/displays`; spec §4). `dopl_show` and every glasses
 * shortcut land here: resolve where it goes (§4.2), post or replace the channel copy through the
 * channels `postMessage` (so authorship, session stamp, mentions and thread tags are exactly a
 * send's), push the caller's own lens copy, and optionally hold for the answer (§3.4).
 */

const HOLD_GRACE_MS = 5_000;
const POLL_MS = 2_000;

export const ShowInputSchema = z
  .object({
    channel: z.string().trim().min(1).max(200).optional(),
    thread: z.string().trim().min(1).max(200).optional(),
    target: z.enum(["auto", "channel", "glasses"]).default("auto"),
    blocks: z.array(z.unknown()).min(1).optional(),
    display_id: z.string().regex(DISPLAY_ID_RE, "display_id must be 1-64 chars of A-Z a-z 0-9 _ -").optional(),
    mention: z.string().trim().max(500).optional(),
    wait: z.boolean().optional(),
    timeout_sec: z.number().optional(),
    template: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    save_as: z.string().optional(),
    validate_only: z.boolean().optional(),
    client_msg_id: z.string().min(1).max(200).optional(),
    // Internal (glasses shortcuts on the app's own loopback client); `dopl_show` never sends them.
    layout: z.enum(["stack", "absolute"]).optional(),
    origin: z.enum(["dopl_show", "glasses_render", "glasses_ask", "glasses_use_template", "glasses_update"]).optional(),
    ttl_sec: z.number().optional(),
    shortcut: z.enum(["render", "ask"]).optional(),
    /** The blocks are the v1 glasses vocabulary (`glasses_render`), read under v1's bounds. */
    v1: z.boolean().optional(),
  })
  .strict();
export type ShowInput = z.input<typeof ShowInputSchema>;
type Input = z.output<typeof ShowInputSchema>;

export interface ShowResult {
  display_id: string;
  message_id?: string;
  channel_id?: string;
  channel_name?: string;
  /** "shown" | "skipped:<reason>" | "off" */
  glasses: string;
  glasses_message_id?: string;
  replaced?: "in-place" | "new";
  /** Why a same-id display became a new message: it was answered, or it gained/lost its choice. */
  replaced_reason?: "answered" | "choice changed";
  decision?: boolean;
  /** `resolved/named` mention handles, when `mention` was given. */
  tags?: string;
  status?: string;
  answer?: DisplayAnswerStamp | null;
  /** The answering member's @handle, when the answer names one (§4.3 `by @handle`). */
  by_handle?: string;
  preview?: string;
  compiled?: unknown;
}

const deps0: GlassesDeps = { store: glassesRepository, devices: deviceRepository };
const bad = (message: string) => new HttpError(400, "DISPLAY_INVALID", message);
const invalid = (errors: unknown[], extra: Record<string, unknown> = {}) =>
  new HttpError(400, "DISPLAY_INVALID", JSON.stringify({ ok: false, errors, ...extra }), { errors, ...extra });
/** A lens that does not fit at any ladder level (§2.5): the level-0 errors and how far it tried. */
const lensInvalid = (lens: { errors: unknown[]; level: number }) =>
  invalid(lens.errors, { tried: `levels 0-${lens.level} (choice notes, spacers, dividers, halved rows)` });

function secondsIn(name: string, v: number | undefined, dflt: number, max: number): number {
  if (v === undefined) return dflt;
  if (!Number.isFinite(v) || v < 5 || v > max) throw bad(`${name} must be 5-${max} seconds`);
  return Math.floor(v);
}

/**
 * The blocks this call shows: its own, or a filled template (optionally saved first). Blocks that
 * hold `{{variables}}` are a template: shown only once `data` fills them (P2-6), saved raw.
 */
async function blocksOf(deps: GlassesDeps, userId: string, input: Input) {
  let raw: { blocks: unknown; layout: DisplayLayout };
  let version: 1 | 2 = input.v1 ? 1 : 2;
  if (input.template) {
    const name = cleanTemplateName(input.template);
    const t = await deps.store.getTemplate(userId, name);
    if (!t) {
      const names = (await deps.store.listTemplates(userId)).map((x) => x.name);
      throw bad(`no template '${name}'; saved: ${names.join(", ") || "none"}`);
    }
    const spec = templateSpecOf(t.spec);
    version = spec.version;
    raw = fillTemplate(spec, input.data) as typeof raw;
  } else if (input.blocks) {
    const own = { blocks: input.blocks, layout: input.layout ?? ("stack" as const) };
    const vars = templateVariables(own.blocks);
    if (vars.length && !input.data) {
      throw bad(`blocks hold {{${vars.join("}}, {{")}}}: pass data to fill them (save_as keeps the placeholders).`);
    }
    if (input.save_as && !input.validate_only) {
      const spec = checkTemplateSpec(own, version);
      await deps.store.saveTemplate(userId, cleanTemplateName(input.save_as), spec, iso(nowOf(deps)));
    }
    raw = vars.length ? (fillTemplate(own, input.data) as typeof raw) : own;
  } else {
    throw bad("blocks (1-24) or template is required");
  }
  // The glasses shortcuts re-show v1-born choices (1-19 items) — tolerant bounds (P1-2).
  const checked = normalizeDisplay(raw, { version, tolerant: input.shortcut === "render" });
  if (!checked.ok) throw invalid(checked.errors);
  return checked.display;
}

/**
 * The channel this call shows in, and the context to post with. A channel id from ANOTHER of the
 * caller's containers resolves there (P2-11: a session channel id arrives without its container)
 * — only for an unfenced credential, and only through the same membership resolution a signed-in
 * request gets (`resolveActiveWorkspace`), so it reaches nothing the caller could not open.
 */
async function channelOf(ctx: ChannelContext, input: Input): Promise<{ channel: ChannelRow; ctx: ChannelContext } | null> {
  const ref = input.channel ?? sessionChannelId(ctx.sessionId);
  if (!ref) return null;
  const action = "show a display in this channel";
  try {
    return { channel: (await requireMemberChannel(ctx, ref, action)).channel, ctx };
  } catch (err) {
    if (!(err instanceof ChannelNotFoundError) || !isUuid(ref) || ctx.apiKeyWorkspaceId) throw err;
    const home = await channelWorkspaceOf(ref);
    if (!home || home === ctx.workspaceId) throw err;
    const { workspace, membership } = await resolveActiveWorkspace(ctx.userId, home);
    const there = { ...ctx, workspaceId: workspace.id, role: membership.role, workspaceKind: workspace.kind };
    return { channel: (await requireMemberChannel(there, ref, action)).channel, ctx: there };
  }
}

/**
 * The channel copy's blocks. A choice that cannot be a decision (a v1-born list of 1, or 13-19,
 * options) is a plain list in chat — answerable on the lens only, never through a lane with no
 * decision behind it (verifier N2).
 */
function channelBlocksOf(blocks: Positioned<DisplayBlock>[], decision: Decision): Positioned<DisplayBlock>[] {
  if (decision || !choiceOf(blocks)) return blocks;
  return blocks.map((b) => {
    if (b.type !== "choice") return b;
    const { options, ...rest } = b;
    return { ...rest, type: "list" as const, items: options.map((o) => o.label) };
  });
}

const firstLine = (blocks: DisplayBlock[]) => firstTextLine(blocks).slice(0, 200) || undefined;

type Decision = ReturnType<typeof decisionIndexOf>;

export async function showDisplay(ctx: ChannelContext, raw: ShowInput, signal?: AbortSignal, deps: GlassesDeps = deps0): Promise<ShowResult> {
  const input = ShowInputSchema.parse(raw);
  const shortcut = input.shortcut ?? null;
  const displayId = input.display_id ?? (shortcut === "render" ? `s-${newDisplayId().slice(2)}` : newDisplayId());
  if (isReservedLensId(displayId)) throw bad('display_id may not start with "reply-" (reserved for agent replies)');
  // Shortcuts keep glasses_ask/glasses_render's long waits (a pending result past the hold cap).
  const timeout = secondsIn("timeout_sec", input.timeout_sec, 120, shortcut ? 86_400 : ASK_HOLD_CAP_SEC);
  const ttl = secondsIn("ttl_sec", input.ttl_sec, 600, 86_400);
  const { blocks, layout } = await blocksOf(deps, ctx.userId, input);
  const choice = choiceOf(blocks);
  const decision = decisionIndexOf(blocks);
  if (input.wait && !choice) throw invalid([{ code: "bad_value", message: "wait needs a choice block (something to answer)" }]);

  const lens = compileForLens(deps, blocks, layout, displayId);
  const lensNote = lens.ok ? (lens.level ? `degraded(level ${lens.level}: ${degradeLabel(lens.level)})` : "fits") : `errors:${JSON.stringify(lens.errors)}`;
  if (input.validate_only) {
    if (input.target === "glasses" && !lens.ok) throw lensInvalid(lens);
    const ascii = lens.ok ? `\n${platformOf(deps).previewScreen(lens.payload)}` : "";
    return {
      display_id: displayId,
      glasses: lensNote,
      preview: `valid · chat: ${blocks.length} blocks · glasses: ${lensNote}${ascii}`,
      ...(shortcut && lens.ok && { compiled: lens.payload }),
    };
  }

  const resolved = await channelOf(ctx, input);
  const channel = resolved?.channel ?? null;
  if (input.target === "channel" && !channel) throw bad("Nowhere to show it: name a channel (no session channel on this call).");
  const devices = input.target === "channel" ? { paired: false, online: false } : await lensState(deps, ctx.userId);
  if (input.target === "glasses" && !devices.paired) throw bad('No paired glasses; use target "channel".');
  if (input.target === "glasses" && !lens.ok) throw lensInvalid(lens);
  const wantLens = input.target === "glasses" || (input.target === "auto" && devices.online && (!!choice || !channel));
  if (!channel && !wantLens) throw bad("Nowhere to show it: name a channel, or pair glasses.");

  // ── THE LENS COPY (the caller's own glasses) ──
  let row: GlassesMessage | null = null;
  let glasses = input.target === "channel" ? "off" : wantLens ? "shown" : devices.online ? "skipped:no choice" : "skipped:no online glasses";
  if (wantLens && !lens.ok) glasses = `skipped:${(lens.errors[0] as { message?: string })?.message ?? "does not fit"}`;
  else if (wantLens && lens.ok) {
    row =
      shortcut === "ask" && choice
        ? await pushAsk(deps, ctx.userId, { question: firstLine(blocks) ?? "", options: choice.options.map((o) => o.label), timeoutSec: timeout })
        : await pushScreen(deps, ctx.userId, { displayId, payload: lens.payload, spec: { spec_version: 2, blocks, ...(layout === "absolute" && { layout }) }, ttlSec: ttl });
  }

  // ── THE CHANNEL COPY ──
  const waitUntil = input.wait ? iso(nowOf(deps) + Math.min(timeout, ASK_HOLD_CAP_SEC) * 1000) : undefined;
  const posted = resolved
    ? await postOrReplace(resolved.ctx, resolved.channel, input, { blocks: channelBlocksOf(blocks, decision), layout, displayId, waitUntil, row, decision })
    : null;
  if (row && posted && row.channel_message_id !== posted.id) await deps.store.linkChannelMessage(ctx.userId, row.id, posted.id);

  console.info(
    "[display] " +
      JSON.stringify({ evt: "display_shown", origin: input.origin ?? "dopl_show", choice: !!choice, targets: [...(posted ? ["channel"] : []), ...(row ? ["glasses"] : [])], degraded_level: lens.ok ? lens.level : null })
  );
  const result: ShowResult = {
    display_id: displayId,
    glasses,
    // A lens row's own status is the glasses shortcuts' (`glasses_render`'s `status`); `dopl_show`
    // reads `status` only as a hold's outcome.
    ...(row && { glasses_message_id: row.id, ...(shortcut && { status: row.status }) }),
    ...(posted && resolved && {
      message_id: posted.id,
      channel_id: resolved.channel.id,
      channel_name: resolved.channel.name,
      decision: !!decision,
      tags: posted.tags,
      ...posted.replaced,
    }),
  };
  if (!input.wait) return result;
  const held = await hold(deps, ctx.userId, { row, messageId: posted?.id ?? null, channelId: resolved?.channel.id ?? null, timeout, choice, signal });
  return { ...result, ...held, ...(held.answer?.by && { by_handle: await handleOf(held.answer.by) }) };
}

/** A member's first @handle (their display name or email slug), for the result line only. */
async function handleOf(userId: string): Promise<string | undefined> {
  try {
    const [p] = await fetchProfiles([userId]);
    const handle = p && memberHandlesOf([{ userId, displayName: p.display_name, email: p.email }])[0];
    return handle ? `@${handle}` : undefined;
  } catch {
    return undefined;
  }
}

interface PostArgs {
  blocks: Positioned<DisplayBlock>[];
  layout: DisplayLayout;
  displayId: string;
  waitUntil?: string;
  row: GlassesMessage | null;
  /** The decision index a choice display posts with, else `null` (a status). */
  decision: Decision;
}

/** Replace-by-id when this author already showed `display_id` here and it is unanswered (§3.5); else post. */
async function postOrReplace(ctx: ChannelContext, channel: ChannelRow, input: Input, a: PostArgs) {
  const handles = (input.mention ?? "").split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith("@") ? h : `@${h}`));
  const body = [handles.join(" "), displayFallback(a.blocks)].filter(Boolean).join("\n");
  const origin: DisplayOrigin = input.origin ?? "dopl_show";
  const stamp = { display_id: a.displayId, wait_until: a.waitUntil, glasses_message_id: a.row?.id, origin };
  let replaced: { replaced: "new"; replaced_reason: "answered" | "choice changed" } | undefined;
  let withdraw: { id: string; body: string; envelope: DisplayEnvelopeV2 } | null = null;
  if (input.display_id) {
    const prior = await findByDisplayId(channel.id, a.displayId, ctx.userId);
    if (prior) {
      const was = displayOf(prior.metadata as Record<string, unknown>);
      const answered = !!was?.answer || (await hasAnswerMessage(channel.id, prior.id));
      // In place only when the message keeps its lane: a status that gains a choice (or loses one)
      // is a different post — a decision is a request, a status a record (P2-1).
      const sameLane = !!was?.decision === !!a.decision;
      if (!answered && sameLane) {
        const envelope: DisplayEnvelopeV2 = {
          spec_version: 2,
          display_id: a.displayId,
          blocks: a.blocks,
          ...(a.layout === "absolute" && { layout: "absolute" as const }),
          ...(a.waitUntil && { wait_until: a.waitUntil }),
          ...(a.row && { glasses_message_id: a.row.id }),
          origin,
        };
        if (await replaceDisplay(prior.id, ctx.userId, body, envelope, a.decision)) {
          return { id: prior.id, replaced: { replaced: "in-place" as const }, tags: tagsOf(prior.metadata, handles) };
        }
      }
      replaced = { replaced: "new", replaced_reason: answered ? "answered" : "choice changed" };
      // An open decision replaced by a status is WITHDRAWN once the new message exists (N1).
      if (!answered && was?.decision) {
        withdraw = { id: prior.id, body: prior.body, envelope: (prior.metadata as { display: DisplayEnvelopeV2 }).display };
      }
    }
  }
  const message = await postMessage(
    ctx,
    channel.id,
    {
      body,
      // An agent's display, even over a cookie-session loopback (the claim only ever narrows the wake).
      authorKind: "agent",
      summary: firstLine(a.blocks),
      display: { blocks: a.blocks, layout: a.layout },
      // A choice posts like a decision (a request for its answerers); anything else informs and
      // wakes nobody (the record lane).
      ...(a.decision ? {} : { intent: "chat" as const }),
      ...(input.thread && { metadata: { taskId: input.thread } }),
      ...(input.client_msg_id && { clientMsgId: input.client_msg_id }),
    },
    { display: stamp }
  );
  if (withdraw) {
    // Same statement as a replace: the index goes (no longer "waiting on you"), and the envelope
    // says what superseded it, so the answer route refuses it and every surface shows it closed.
    await replaceDisplay(withdraw.id, ctx.userId, withdraw.body, { ...withdraw.envelope, superseded_by: message.id }, null);
  }
  return { id: message.id, replaced, tags: tagsOf(message.metadata, handles) };
}

function tagsOf(metadata: unknown, handles: string[]): string {
  return `${mentionedUserIdsOf(metadata as Record<string, unknown>).length}/${handles.length}`;
}

/**
 * Hold for the answer (§3.4): the lens row (a tap) and the channel stamp, every 2s, until
 * `wait_until` + 5s so an answer sent as a record just before the deadline is still returned.
 */
async function hold(
  deps: GlassesDeps,
  userId: string,
  h: { row: GlassesMessage | null; messageId: string | null; channelId: string | null; timeout: number; choice: ChoiceBlock | null; signal?: AbortSignal }
): Promise<Pick<ShowResult, "status" | "answer">> {
  const sleep = sleepOf(deps);
  const start = nowOf(deps);
  const holdMs = Math.min(h.timeout, ASK_HOLD_CAP_SEC) * 1000 + HOLD_GRACE_MS;
  while (nowOf(deps) - start < holdMs && !h.signal?.aborted) {
    await sleep(POLL_MS);
    // Both sides at once: they are independent reads, and the channel stamp still wins.
    const [msg, cur] = await Promise.all([
      h.messageId && h.channelId ? findMessageById(h.channelId, h.messageId) : null,
      h.row ? deps.store.get(userId, h.row.id) : null,
    ]);
    const answer = msg && displayOf(msg.metadata as Record<string, unknown>)?.answer;
    if (answer) return { status: "answered", answer };
    if (h.row) {
      if (cur?.status === "answered" && cur.answer) {
        const { index, at } = cur.answer;
        // The display's own option is the answer's label (the lens text may carry its "(rec)" mark).
        const option = h.choice?.options[index];
        const choice = option?.label ?? cur.answer.choice;
        return { status: "answered", answer: { block_id: h.choice?.id ?? cur.answer.block_id ?? "", index, choice, at, via: "glasses" } };
      }
      if (cur?.status === "dismissed") return { status: "dismissed", answer: null };
      if (cur?.status === "expired" && !h.messageId) return { status: "timeout", answer: null };
    }
  }
  const pending = h.timeout > ASK_HOLD_CAP_SEC && !h.signal?.aborted;
  return { status: pending ? "pending" : "timeout", answer: null };
}
