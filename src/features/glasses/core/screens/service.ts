import { randomBytes } from "node:crypto";
import { iso, nowOf } from "../clock";
import {
  ASK_HOLD_CAP_SEC,
  RESERVED_CARD_PREFIX,
  holdFor,
  platformOf,
  type GlassesDeps,
} from "../messages/service";
import type { GlassesAnswer, GlassesMessage, GlassesStatus, ScreenPayload } from "../messages/types";
import { GlassesValidationError, cleanSeconds } from "../validation";
import type { ScreenError } from "./spec";
import { checkTemplateSpec, cleanTemplateName, fillTemplate, templateVariables } from "./template";

/**
 * Agent-built screens: `glasses_render`, `glasses_update` and the template
 * tools. Compile for the platform → (preview | insert-or-replace by screen_id)
 * → optional hold for input, the same hold shape as `glasses_ask`.
 */

/** Compile errors travel as a JSON tool error the agent can act on. */
export class ScreenInvalidError extends GlassesValidationError {
  constructor(public readonly errors: ScreenError[]) {
    super(JSON.stringify({ ok: false, errors }));
  }
}

const SCREEN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** A screen that took a tap is still the screen on the glasses, so it stays replaceable. */
const LIVE: GlassesStatus[] = ["pending", "delivered", "answered"];

function cleanScreenId(v: unknown): string {
  if (v === undefined || v === null) return `s-${randomBytes(4).toString("hex")}`;
  if (typeof v !== "string" || !SCREEN_ID_RE.test(v)) {
    throw new GlassesValidationError("screen_id must be 1-64 chars of A-Z a-z 0-9 _ -");
  }
  if (v.startsWith(RESERVED_CARD_PREFIX)) {
    throw new GlassesValidationError(`screen_id may not start with "${RESERVED_CARD_PREFIX}" (reserved for agent replies)`);
  }
  return v;
}

function compileOrThrow(deps: GlassesDeps, spec: unknown, screenId: string): ScreenPayload {
  const res = platformOf(deps).compileScreen(spec, screenId);
  if (!res.ok) throw new ScreenInvalidError(res.errors);
  return res.payload;
}

export interface RenderArgs {
  screen_id?: unknown;
  blocks?: unknown;
  layout?: unknown;
  wait_for_input?: unknown;
  timeout_sec?: unknown;
  ttl_sec?: unknown;
  validate_only?: unknown;
}

type ScreenInput = Omit<GlassesAnswer, "block_id"> & { block_id: string | null };

export async function renderScreen(
  deps: GlassesDeps,
  userId: string,
  args: RenderArgs,
  signal?: AbortSignal,
) {
  const screenId = cleanScreenId(args.screen_id);
  const spec = { blocks: args.blocks, layout: args.layout ?? "stack" };
  const payload = compileOrThrow(deps, spec, screenId);
  if (args.validate_only === true) {
    return { ok: true, screen_id: screenId, compiled: payload, preview: platformOf(deps).previewScreen(payload) };
  }
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 600, 5, 86_400);
  const timeout = cleanSeconds("timeout_sec", args.timeout_sec, 120, 5, 86_400);
  const now = nowOf(deps);
  const existing = await deps.store.findActiveCard(userId, screenId, iso(now), "screen", LIVE);
  const row = existing
    ? await deps.store.refreshCard(userId, existing.id, payload, iso(now + ttl * 1000), iso(now), spec)
    : await deps.store.insert(userId, {
        kind: "screen",
        card_id: screenId,
        payload,
        spec,
        expires_at: iso(now + ttl * 1000),
        now: iso(now),
      });
  if (args.wait_for_input !== true) return { id: row.id, screen_id: screenId, status: row.status };
  return holdForInput(deps, userId, row, screenId, timeout, signal);
}

async function holdForInput(
  deps: GlassesDeps,
  userId: string,
  row: GlassesMessage,
  screenId: string,
  timeoutSec: number,
  signal?: AbortSignal,
) {
  const base = { id: row.id, screen_id: screenId };
  const settled = await holdFor(
    deps,
    userId,
    row.id,
    timeoutSec,
    (cur) => {
      if (cur?.status === "answered" && cur.answer) {
        const a = cur.answer;
        const input: ScreenInput = { block_id: a.block_id ?? null, choice: a.choice, index: a.index, at: a.at };
        return { ...base, status: "answered" as const, input };
      }
      if (cur?.status === "dismissed" || cur?.status === "expired") return { ...base, status: cur.status, input: null };
      return null;
    },
    signal,
  );
  if (settled) return settled;
  // The screen stays up on timeout (its own ttl governs it); only the wait ends.
  if (timeoutSec <= ASK_HOLD_CAP_SEC && !signal?.aborted) return { ...base, status: "timeout" as const, input: null };
  return { ...base, status: "pending" as const, input: null, note: "Still on the glasses. Call glasses_get_answer with this id later." };
}

const PATCHABLE = ["content", "items", "value", "label"] as const;

export async function updateScreen(
  deps: GlassesDeps,
  userId: string,
  args: { screen_id?: unknown; patches?: unknown },
) {
  if (typeof args.screen_id !== "string" || !SCREEN_ID_RE.test(args.screen_id)) {
    throw new GlassesValidationError("screen_id must be the id glasses_render returned");
  }
  if (!Array.isArray(args.patches) || args.patches.length === 0) {
    throw new GlassesValidationError("patches must be a non-empty array of {id, content|items|value|label}");
  }
  const now = nowOf(deps);
  const row = await deps.store.findActiveCard(userId, args.screen_id, iso(now), "screen", LIVE);
  if (!row) {
    throw new GlassesValidationError(`no live screen '${args.screen_id}'; render it first with glasses_render`);
  }
  const spec = (await deps.store.getSpec(userId, row.id)) as { blocks: Record<string, unknown>[]; layout?: string };
  const blocks: Record<string, unknown>[] = spec.blocks.map((b, i) => ({
    ...b,
    id: typeof b.id === "string" ? b.id : `b${i + 1}`,
  }));
  for (const p of args.patches as Record<string, unknown>[]) {
    const target = blocks.find((b) => b.id === p?.id);
    if (!target) {
      throw new GlassesValidationError(
        `no block '${String(p?.id)}' on screen ${args.screen_id}; ids: ${blocks.map((b) => b.id).join(", ")}`,
      );
    }
    for (const k of PATCHABLE) if (p[k] !== undefined) target[k] = p[k];
  }
  const next = { blocks, layout: spec.layout ?? "stack" };
  const payload = compileOrThrow(deps, next, args.screen_id);
  const updated = await deps.store.refreshCard(userId, row.id, payload, row.expires_at, iso(now), next);
  return { id: updated.id, screen_id: args.screen_id, status: updated.status };
}

export async function saveTemplate(
  deps: GlassesDeps,
  userId: string,
  args: { name?: unknown; blocks?: unknown; layout?: unknown },
) {
  const name = cleanTemplateName(args.name);
  const spec = checkTemplateSpec({ blocks: args.blocks, layout: args.layout }, platformOf(deps).screenLimits.max_blocks);
  const t = await deps.store.saveTemplate(userId, name, spec, iso(nowOf(deps)));
  return { name: t.name, variables: templateVariables(spec), updated_at: t.updated_at };
}

export async function listTemplates(deps: GlassesDeps, userId: string) {
  const rows = await deps.store.listTemplates(userId);
  return {
    templates: rows.map((t) => ({
      name: t.name,
      variables: templateVariables(t.spec),
      blocks: ((t.spec as { blocks?: unknown[] })?.blocks ?? []).length,
      updated_at: t.updated_at,
    })),
  };
}

export async function useTemplate(
  deps: GlassesDeps,
  userId: string,
  args: RenderArgs & { name?: unknown; data?: unknown },
  signal?: AbortSignal,
) {
  const name = cleanTemplateName(args.name);
  const t = await deps.store.getTemplate(userId, name);
  if (!t) {
    const names = (await deps.store.listTemplates(userId)).map((x) => x.name);
    throw new GlassesValidationError(`no template '${name}'; saved: ${names.join(", ") || "none"}`);
  }
  const data = args.data && typeof args.data === "object" ? (args.data as Record<string, unknown>) : {};
  const filled = fillTemplate(t.spec, data) as { blocks?: unknown; layout?: unknown };
  return renderScreen(deps, userId, { ...args, blocks: filled.blocks, layout: filled.layout }, signal);
}
