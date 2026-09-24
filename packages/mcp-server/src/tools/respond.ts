/**
 * Response + op-dispatch helpers for the `dopl_<domain>` tools: one `op` discriminator over a flat
 * schema, with each op's required params checked at runtime by {@link missingParams}.
 */

import { z, type ZodRawShape } from "zod";
import { calledAs } from "../call-ref.js";
import {
  CREDITS_EXHAUSTED,
  MISSING_PARAMS,
  refusal,
  UNUSED_PARAM,
} from "./tool-errors";

export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type RegisterTool = <S extends ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
) => void;

/** Meta-path options. The charge is opt-in: only `dopl_status` pays. */
export interface MetaToolOptions {
  /** Spend one credit before the handler runs. */
  charged?: boolean;
}

/** Structurally assignable to {@link RegisterTool}: the extra parameter is optional. */
export type RegisterMetaTool = <S extends ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  opts?: MetaToolOptions,
) => void;

export function ok(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

export function err(message: string): ToolResponse {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** HTTP 412. Duck-typed so this package need not import the client's error class. */
export function isConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 412
  );
}

/** True for a 404. Same duck-typing as `isConflict`. */
export function isNotFound(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 404
  );
}

/** Duck-typed match on a `@dopl/client` error's status and code. */
export function isApiError(e: unknown, status: number, code: string): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === status &&
    (e as { code?: unknown }).code === code
  );
}

/** The `code` a DoplApiError carries, or null (duck-typed, like {@link isApiError}). */
export function apiErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** The server's own sentence, or null. Prefer it: the server knows which gate refused. */
export function apiMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return typeof msg === "string" && msg ? msg : null;
}

/** True for a 409 (name/title/slug already-exists collision). */
export function isAlreadyExists(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 409
  );
}

/** Credit allowance spent for the billing period. */
export const CREDITS_EXHAUSTED_CODE = CREDITS_EXHAUSTED.reason;

// The code's meaning already says "out of credits" (pinned by `credits.test.ts`); don't repeat it.
const CREDITS_EXHAUSTED_MESSAGE = refusal(
  CREDITS_EXHAUSTED,
  "Nothing was deleted — credits reset at the start of the next period, and upgrading raises the monthly allowance.",
);

// Plan-gate codes (flat `{ error, message, upgrade_url }` envelope); the data is always intact.
const ENTITLEMENT_CODES = new Set([
  "over_free_cap",
  "chat_outside_retention",
  "kb_storage_full",
  CREDITS_EXHAUSTED_CODE,
]);

/** The consume answer; every field optional (older servers omit some, degraded ones zero them). */
export interface CreditsOutcome {
  wallet?: "personal" | "seat" | null;
  used?: number;
  limit?: number;
  periodEnd?: string;
  upgradeUrl?: string;
  /** What `upgradeUrl` buys, from the server (F-668). Absent or 0 drops the figure; not `limit`. */
  upgradeCredits?: number;
}

/** ISO timestamp → `YYYY-MM-DD`, or null (which omits the "Resets …" sentence). */
function periodEndDate(periodEnd: string | undefined): string | null {
  if (typeof periodEnd !== "string") return null;
  const day = periodEnd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return Number.isNaN(Date.parse(periodEnd)) ? null : day;
}

/**
 * ` for 5,000 credits <unit>`, or `""`: the whole clause goes, never a figureless preposition.
 * `0` means no offer to size (degraded answers send it), not an allowance of zero.
 */
function upgradeFigure(credits: number | undefined, unit: string): string {
  if (!Number.isFinite(credits) || (credits as number) <= 0) return "";
  return ` for ${(credits as number).toLocaleString("en-US")} credits ${unit}`;
}

/** `(1,000/5,000)`, or "" when the server sent no usable counters. */
function usageSpan(used: number | undefined, limit: number | undefined): string {
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return "";
  return ` (${(used as number).toLocaleString("en-US")}/${(limit as number).toLocaleString("en-US")})`;
}

/**
 * Credits refusal in the entitlement shape. Names whose counter stopped (nothing is pooled); the
 * upgrade line is decided by `upgradeUrl`, never by the wallet; no `wallet` → the generic sentence.
 */
export function creditsExhausted(o: CreditsOutcome): ToolResponse {
  const url = typeof o.upgradeUrl === "string" ? o.upgradeUrl : "";
  const span = usageSpan(o.used, o.limit);
  const day = periodEndDate(o.periodEnd);
  const resets = day ? ` Resets ${day}.` : "";

  if (o.wallet === "seat") {
    const head = `Your seat in this workspace is out of credits for this period${span}.${resets}`;
    const buys = upgradeFigure(o.upgradeCredits, "per member");
    return err(url ? `${head}\n\nUpgrade to Team${buys}: ${url}` : head);
  }
  if (o.wallet === "personal") {
    const head = `Your personal credits are used up for this month${span}.${resets}`;
    const buys = upgradeFigure(o.upgradeCredits, "a month");
    return err(url ? `${head}\n\nUpgrade to Pro${buys}: ${url}` : head);
  }
  return err(
    url
      ? `${CREDITS_EXHAUSTED_MESSAGE}\n\nUpgrade to continue: ${url}`
      : CREDITS_EXHAUSTED_MESSAGE,
  );
}

/** Plan-gate 403 → tool error with the server's message and upgrade link verbatim; else null. */
export function entitlementDenied(e: unknown): ToolResponse | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== "string" || !ENTITLEMENT_CODES.has(code)) {
    return null;
  }
  const rec = e as { apiMessage?: unknown; upgradeUrl?: unknown };
  const message =
    typeof rec.apiMessage === "string" && rec.apiMessage
      ? rec.apiMessage
      : code === "chat_outside_retention"
        ? "This chat is older than the free plan's history window. Nothing was deleted — upgrade to Team to restore full chat history."
        : code === CREDITS_EXHAUSTED_CODE
          ? CREDITS_EXHAUSTED_MESSAGE
          : code === "kb_storage_full"
            ? "This knowledge base has reached its storage limit. Nothing was deleted — it stays readable, and deleting files or writing a smaller one still works."
            : "This workspace has reached its free plan object limit. Nothing was deleted — existing objects stay readable and editable.";
  const url = typeof rec.upgradeUrl === "string" ? rec.upgradeUrl : "";
  return err(url ? `${message}\n\nUpgrade to continue: ${url}` : message);
}

/** Refusal when any `required` param is absent (undefined, null or ""), else null. */
export function missingParams(
  op: string,
  args: Record<string, unknown>,
  required: string[],
): ToolResponse | null {
  const missing = required.filter((k) => {
    const v = args[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length === 0) return null;
  const plural = missing.length === 1 ? "param" : "params";
  // Through the declared code, so the wire matches the `reason=` every description teaches.
  return err(
    refusal(MISSING_PARAMS, `${calledAs(op)} is missing required ${plural}: ${missing.join(", ")}.`),
  );
}

/**
 * Refusal when a param the op does NOT take was sent (a flat schema cannot say "this key belongs to
 * that op"), else null. `allowed` is the op's own keys; `op`/`action` always pass. An ignored param
 * would narrate success over an argument that did nothing.
 */
export function unusedParams(
  op: string,
  args: Record<string, unknown>,
  allowed: readonly string[],
): ToolResponse | null {
  const own = new Set(["op", "action", ...allowed]);
  const stray = Object.keys(args).filter((k) => !own.has(k) && args[k] !== undefined);
  if (stray.length === 0) return null;
  return err(
    refusal(UNUSED_PARAM, `${calledAs(op)} does not take: ${stray.join(", ")}. It takes: ${allowed.join(", ")}.`),
  );
}

/** An op's whole param contract in one call: `missingParams` over `required`, then `unusedParams`
 *  over `required` + `optional`. */
export function strictParams(
  op: string,
  args: Record<string, unknown>,
  required: string[],
  optional: readonly string[] = [],
): ToolResponse | null {
  return missingParams(op, args, required) ?? unusedParams(op, args, [...required, ...optional]);
}
