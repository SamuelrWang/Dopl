import "server-only";
import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { sessionChannelId } from "@/shared/auth/session-header";
import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel, type ChannelContext } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import type { ChannelRow } from "@/features/channels/server/dto";
import { mentionedUserIdsOf } from "@/features/channels/lib/mentions";
import { iso, nowOf, sleepOf } from "@/features/glasses/core/clock";
import { deviceRepository } from "@/features/glasses/core/devices/repository";
import { glassesRepository } from "@/features/glasses/core/messages/repository";
import { ASK_HOLD_CAP_SEC, platformOf, type GlassesDeps } from "@/features/glasses/core/messages/service";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { decisionIndexOf, displayOf } from "../core/adapt";
import { degradeLabel } from "../core/degrade";
import { displayFallback } from "../core/fallback";
import { normalizeDisplay } from "../core/normalize";
import { checkTemplateSpec, cleanTemplateName, fillTemplate, templateSpecOf } from "../core/template";
import {
  DISPLAY_ID_RE,
  choiceOf,
  newDisplayId,
  type DisplayAnswerStamp,
  type DisplayBlock,
  type DisplayEnvelopeV2,
  type DisplayLayout,
  type DisplayOrigin,
  type Positioned,
} from "../core/types";
import { compileForLens, isReservedLensId, lensState, pushAsk, pushScreen } from "./lens";
import { findByDisplayId, hasAnswerMessage, replaceDisplay } from "./repository";

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
  decision?: boolean;
  /** `resolved/named` mention handles, when `mention` was given. */
  tags?: string;
  status?: string;
  answer?: DisplayAnswerStamp | null;
  preview?: string;
  compiled?: unknown;
}

const deps0: GlassesDeps = { store: glassesRepository, devices: deviceRepository };
const bad = (message: string) => new HttpError(400, "DISPLAY_INVALID", message);
const invalid = (errors: unknown[]) => new HttpError(400, "DISPLAY_INVALID", JSON.stringify({ ok: false, errors }), { errors });

function secondsIn(name: string, v: number | undefined, dflt: number, max: number): number {
  if (v === undefined) return dflt;
  if (!Number.isFinite(v) || v < 5 || v > max) throw bad(`${name} must be 5-${max} seconds`);
  return Math.floor(v);
}

/** The blocks this call shows: its own, or a filled template (optionally saved first). */
async function blocksOf(deps: GlassesDeps, userId: string, input: Input) {
  let raw: { blocks: unknown; layout: DisplayLayout };
  if (input.template) {
    const name = cleanTemplateName(input.template);
    const t = await deps.store.getTemplate(userId, name);
    if (!t) {
      const names = (await deps.store.listTemplates(userId)).map((x) => x.name);
      throw bad(`no template '${name}'; saved: ${names.join(", ") || "none"}`);
    }
    raw = fillTemplate(templateSpecOf(t.spec), input.data) as typeof raw;
  } else if (input.blocks) {
    raw = { blocks: input.blocks, layout: input.layout ?? "stack" };
  } else {
    throw bad("blocks (1-24) or template is required");
  }
  const checked = normalizeDisplay(raw);
  if (!checked.ok) throw invalid(checked.errors);
  if (input.save_as && !input.validate_only) {
    const spec = checkTemplateSpec({ blocks: raw.blocks, layout: raw.layout });
    await deps.store.saveTemplate(userId, cleanTemplateName(input.save_as), spec, iso(nowOf(deps)));
  }
  return checked.display;
}

async function channelOf(ctx: ChannelContext, input: Input): Promise<ChannelRow | null> {
  const ref = input.channel ?? sessionChannelId(ctx.sessionId);
  if (!ref) return null;
  const { channel } = await requireMemberChannel(ctx, ref, "show a display in this channel");
  return channel;
}

const firstLine = (blocks: DisplayBlock[]) => {
  const b = blocks.find((x) => x.type === "heading" || x.type === "text");
  const line = b ? (b.type === "heading" ? b.text : b.type === "text" ? b.content : "").split("\n")[0] : "";
  return line.slice(0, 200) || undefined;
};

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
  if (input.wait && !choice) throw invalid([{ code: "bad_value", message: "wait needs a choice block (something to answer)" }]);

  const lens = compileForLens(deps, blocks, layout, displayId);
  const lensNote = lens.ok ? (lens.level ? `degraded(level ${lens.level}: ${degradeLabel(lens.level)})` : "fits") : `errors:${JSON.stringify(lens.errors)}`;
  if (input.validate_only) {
    if (input.target === "glasses" && !lens.ok) throw invalid(lens.errors);
    const ascii = lens.ok ? `\n${platformOf(deps).previewScreen(lens.payload)}` : "";
    return {
      display_id: displayId,
      glasses: lensNote,
      preview: `valid · chat: ${blocks.length} blocks · glasses: ${lensNote}${ascii}`,
      ...(shortcut && lens.ok && { compiled: lens.payload }),
    };
  }

  const channel = await channelOf(ctx, input);
  if (input.target === "channel" && !channel) throw bad("Nowhere to show it: name a channel (no session channel on this call).");
  const devices = input.target === "channel" ? { paired: false, online: false } : await lensState(deps, ctx.userId);
  if (input.target === "glasses" && !devices.paired) throw bad('No paired glasses; use target "channel".');
  if (input.target === "glasses" && !lens.ok) throw invalid(lens.errors);
  const wantLens = input.target === "glasses" || (input.target === "auto" && devices.online && (!!choice || !channel));
  if (!channel && !wantLens) throw bad("Nowhere to show it: name a channel, or pair glasses.");

  // ── THE LENS COPY (the caller's own glasses) ──
  let row: GlassesMessage | null = null;
  let glasses = input.target === "channel" ? "off" : wantLens ? "shown" : "skipped:no online glasses";
  if (wantLens && !lens.ok) glasses = `skipped:${(lens.errors[0] as { message?: string })?.message ?? "does not fit"}`;
  else if (wantLens && lens.ok) {
    row =
      shortcut === "ask" && choice
        ? await pushAsk(deps, ctx.userId, { question: firstLine(blocks) ?? "", options: choice.options.map((o) => o.label), timeoutSec: timeout })
        : await pushScreen(deps, ctx.userId, { displayId, payload: lens.payload, spec: { spec_version: 2, blocks, ...(layout === "absolute" && { layout }) }, ttlSec: ttl });
  }

  // ── THE CHANNEL COPY ──
  const waitUntil = input.wait ? iso(nowOf(deps) + Math.min(timeout, ASK_HOLD_CAP_SEC) * 1000) : undefined;
  const posted = channel
    ? await postOrReplace(ctx, channel, input, { blocks, layout, displayId, waitUntil, row, choice: !!choice })
    : null;
  if (row && posted && row.channel_message_id !== posted.id) await deps.store.linkChannelMessage(ctx.userId, row.id, posted.id);

  console.info(
    "[display] " +
      JSON.stringify({ evt: "display_shown", origin: input.origin ?? "dopl_show", choice: !!choice, targets: [...(posted ? ["channel"] : []), ...(row ? ["glasses"] : [])], degraded_level: lens.ok ? lens.level : null })
  );
  const result: ShowResult = {
    display_id: displayId,
    glasses,
    ...(row && { glasses_message_id: row.id, status: row.status }),
    ...(posted && { message_id: posted.id, channel_id: channel!.id, channel_name: channel!.name, decision: !!choice, ...(posted.replaced && { replaced: posted.replaced }) }),
    ...(posted?.tags && { tags: posted.tags }),
  };
  if (!input.wait) return result;
  return { ...result, ...(await hold(deps, ctx.userId, { row, messageId: posted?.id ?? null, channelId: channel?.id ?? null, timeout, signal })) };
}

interface PostArgs {
  blocks: Positioned<DisplayBlock>[];
  layout: DisplayLayout;
  displayId: string;
  waitUntil?: string;
  row: GlassesMessage | null;
  choice: boolean;
}

/** Replace-by-id when this author already showed `display_id` here and it is unanswered (§3.5); else post. */
async function postOrReplace(ctx: ChannelContext, channel: ChannelRow, input: Input, a: PostArgs) {
  const handles = (input.mention ?? "").split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith("@") ? h : `@${h}`));
  const body = [handles.join(" "), displayFallback(a.blocks)].filter(Boolean).join("\n");
  const origin: DisplayOrigin = input.origin ?? "dopl_show";
  const stamp = { display_id: a.displayId, wait_until: a.waitUntil, glasses_message_id: a.row?.id, origin };
  let replaced: "in-place" | "new" | undefined;
  if (input.display_id) {
    const prior = await findByDisplayId(channel.id, a.displayId, ctx.userId);
    if (prior) {
      const answered = !!displayOf(prior.metadata as Record<string, unknown>)?.answer || (await hasAnswerMessage(channel.id, prior.id));
      if (!answered) {
        const envelope: DisplayEnvelopeV2 = {
          spec_version: 2,
          display_id: a.displayId,
          blocks: a.blocks,
          ...(a.layout === "absolute" && { layout: "absolute" as const }),
          ...(a.waitUntil && { wait_until: a.waitUntil }),
          ...(a.row && { glasses_message_id: a.row.id }),
          origin,
        };
        if (await replaceDisplay(prior.id, ctx.userId, body, envelope, decisionIndexOf(a.blocks))) {
          return { id: prior.id, replaced: "in-place" as const, tags: tagsOf(prior.metadata, handles) };
        }
      }
      replaced = "new";
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
      ...(a.choice ? {} : { intent: "chat" as const }),
      ...(input.thread && { metadata: { taskId: input.thread } }),
      ...(input.client_msg_id && { clientMsgId: input.client_msg_id }),
    },
    { display: stamp }
  );
  return { id: message.id, replaced, tags: tagsOf(message.metadata, handles) };
}

function tagsOf(metadata: unknown, handles: string[]): string | undefined {
  if (handles.length === 0) return undefined;
  return `${mentionedUserIdsOf(metadata as Record<string, unknown>).length}/${handles.length}`;
}

/**
 * Hold for the answer (§3.4): the lens row (a tap) and the channel stamp, every 2s, until
 * `wait_until` + 5s so an answer sent as a record just before the deadline is still returned.
 */
async function hold(
  deps: GlassesDeps,
  userId: string,
  h: { row: GlassesMessage | null; messageId: string | null; channelId: string | null; timeout: number; signal?: AbortSignal }
): Promise<Pick<ShowResult, "status" | "answer">> {
  const sleep = sleepOf(deps);
  const start = nowOf(deps);
  const holdMs = Math.min(h.timeout, ASK_HOLD_CAP_SEC) * 1000 + HOLD_GRACE_MS;
  while (nowOf(deps) - start < holdMs && !h.signal?.aborted) {
    await sleep(POLL_MS);
    if (h.messageId && h.channelId) {
      const msg = await findMessageById(h.channelId, h.messageId);
      const answer = displayOf(msg?.metadata as Record<string, unknown>)?.answer;
      if (answer) return { status: "answered", answer };
    }
    if (h.row) {
      const cur = await deps.store.get(userId, h.row.id);
      if (cur?.status === "answered" && cur.answer) {
        const { block_id, index, choice, at } = cur.answer;
        return { status: "answered", answer: { block_id: block_id ?? "", index, choice, at, via: "glasses" } };
      }
      if (cur?.status === "dismissed") return { status: "dismissed", answer: null };
      if (cur?.status === "expired" && !h.messageId) return { status: "timeout", answer: null };
    }
  }
  const pending = h.timeout > ASK_HOLD_CAP_SEC && !h.signal?.aborted;
  return { status: pending ? "pending" : "timeout", answer: null };
}
