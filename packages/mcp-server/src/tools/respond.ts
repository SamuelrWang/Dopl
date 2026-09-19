/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */

import { z, type ZodRawShape } from "zod";
import {
  CREDITS_EXHAUSTED,
  MISSING_PARAMS,
  refusal,
  SESSION_REQUIRED,
} from "./tool-errors";

/** A tool result: text blocks, plus the error flag. */
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

/**
 * Per-tool options on the META registration path.
 *
 * ⚠ `charged` EXISTS BECAUSE ONE META TOOL IS NOT LIKE THE OTHERS (Samuel's
 * ruling Q2 (b), 2026-08-28). `dopl_workspaces` is
 * uncharged BY DECISION — they are how a lost agent finds out where it is —
 * while `dopl_home` READS CONTENT-ADJACENT DATA AND WRITES, so it pays like a
 * domain tool. It cannot use the domain path at all: that path injects a
 * `workspace=` arg, and this tool is the one that tells you what the containers
 * to pass there even ARE.
 *
 * ⚠ OPT-IN, NEVER A DEFAULT. A blanket charge on this path would meter the two
 * orientation tools, which is the decision the registrar's docblock records and
 * this flag exists to preserve.
 */
export interface MetaToolOptions {
  /** Spend one MCP credit before the handler runs. Default false. */
  charged?: boolean;
}

/** The META registration path. ⚠ Structurally assignable to {@link RegisterTool}
 *  (the extra parameter is optional), so every existing meta registrar keeps
 *  its type. */
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

/**
 * True for an optimistic-concurrency conflict (HTTP 412). ⚠ Duck-typed on
 * `.status` to work across the @dopl/client boundary without importing the
 * error class.
 */
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

/**
 * Duck-typed match on a `@dopl/client` HTTP error's STATUS **and** its `code`.
 *
 * ⚠ **ONE COPY OF THE DUCK-TYPE, MANY SENTENCES.** Four mappers across the agent
 * and knowledge surfaces were each re-typing this five-line shape
 * (`typeof e === "object" && e !== null && e.status === … && e.code === …`), and
 * a fifth was written for the KB copy on 2026-09-02. The PREDICATE is one fact
 * about the wire; the MESSAGE is domain prose and stays with its domain, which
 * is why this exports the test rather than a message builder.
 * ⚠ Duck-typed on purpose — this package must not import the client's error
 * class to ask a question about a status code.
 */
export function isApiError(e: unknown, status: number, code: string): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === status &&
    (e as { code?: unknown }).code === code
  );
}

/**
 * The SERVER's own human sentence off an api error, or null when it sent none.
 * ⚠ Prefer it over a hand-written one wherever it exists: the server knows which
 * credential class or gate refused, and this layer does not.
 */
export function apiMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return typeof msg === "string" && msg ? msg : null;
}

/**
 * 🔒 **AN APP-ONLY ROUTE, ANSWERED AS A REFUSAL (S43, 2026-09-18).**
 * `shared/auth/with-auth.ts`'s `sessionOnly` refuses every OAuth bearer with a
 * 403 `SESSION_REQUIRED` — and every MCP caller is an OAuth bearer, so this is
 * not a permission that can be granted to a session; it is the door being
 * closed to this whole class of caller.
 *
 * ⚠ **IT LIVES HERE RATHER THAN IN ONE TOOL BECAUSE THE GATE IS CROSS-CUTTING.**
 * ⚠ **AND IT HAS NO CALLER AS OF 2026-09-19, WHICH IS A FACT AND NOT AN
 * OVERSIGHT.** The pin verbs raised it, and Samuel's ruling deleted knowledge
 * pinning outright; the delete routes, `channel-grants` and the template delete
 * carry the same `sessionOnly` wrapper option, so the next op that grows an arm
 * gets this sentence rather than a second wording of it. It is asserted
 * directly by `knowledge-refusals.test.ts › S43`, which is what keeps an
 * uncalled helper from quietly rotting.
 * ⚠ **IT NAMES THE OP AND SAYS NOTHING CHANGED**, because a caller that reads
 * "forbidden" alone re-issues, and this call can only ever answer the same way.
 *
 * Null when the error is anything else, so the caller rethrows.
 */
export function sessionRequired(e: unknown, op: string): ToolResponse | null {
  if (!isApiError(e, 403, "SESSION_REQUIRED")) return null;
  return err(
    refusal(
      SESSION_REQUIRED,
      `op="${op}" is app-only and NOTHING changed. Your token is an agent credential, which this route refuses whatever scopes it carries — there is no permission to request and no other route in. Ask your operator to do it in the Dopl app.`,
    ),
  );
}

/** True for a 409 (name/title/slug already-exists collision). */
export function isAlreadyExists(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 409
  );
}

/**
 * Credit allowance spent for the billing period. ⚠ ONE wording for both
 * surfaces: the registrar's up-front refusal (reading `allowed: false` off the
 * consume response, not an error) and `entitlementDenied` below.
 */
export const CREDITS_EXHAUSTED_CODE = CREDITS_EXHAUSTED.reason;

// ⚠ THE `reason=` PREFIX IS ADDITIVE AND THE SENTENCE IS NOT REPEATED (A14).
// `credits.test.ts` pins "out of credits", which the CODE's own meaning now
// carries — so the detail adds only what the meaning does not say, rather than
// restating it a second time on the same line.
const CREDITS_EXHAUSTED_MESSAGE = refusal(
  CREDITS_EXHAUSTED,
  "Nothing was deleted — credits reset at the start of the next period, and upgrading raises the monthly allowance.",
);

/**
 * Plan-gate denial codes returned as a flat
 * `{ error: <code>, message, upgrade_url }` envelope. All mean "the data is
 * intact, upgrading lifts the gate". `kb_storage_full` reaches an agent through
 * the ordinary write path — `kb_*` writes are loopback HTTP into the same route
 * handlers a browser uses, so one server-side gate covers both surfaces.
 */
const ENTITLEMENT_CODES = new Set([
  "over_free_cap",
  "chat_outside_retention",
  "kb_storage_full",
  CREDITS_EXHAUSTED_CODE,
]);

/**
 * The consume answer, as much of it as the refusal wording needs. ⚠ **EVERY
 * FIELD IS OPTIONAL BECAUSE THE WIRE MAKES IT SO** — an older server sends no
 * `wallet`, and a degraded answer zeroes the counters — so this renders what it
 * was given and never invents the rest.
 */
export interface CreditsOutcome {
  wallet?: "personal" | "seat" | null;
  used?: number;
  limit?: number;
  periodEnd?: string;
  upgradeUrl?: string;
  /**
   * 🔒 **WHAT THE OFFER AT `upgradeUrl` BUYS — FROM THE SERVER, BECAUSE THIS
   * PACKAGE CANNOT KNOW IT (2026-09-14, F-668 CLOSED).** The two upsell
   * sentences below quoted a literal `5,000` against
   * `src/features/billing/credits.ts › SEAT_MONTHLY_CREDITS.team` and
   * `› PERSONAL_MONTHLY_CREDITS.pro`; this build cannot import `src/`, so
   * retuning a paid allowance was a THREE-SITE edit and **no test could see the
   * drift** — the pin here asserted the literal against itself while the
   * app-side pin read the constant, and both stayed green while they disagreed.
   * The figure rides the consume response now, exactly as `upgradeUrl` already
   * does (`billing/server/credits-service.ts › upgradeCreditsFor`), so the
   * number has ONE home again and the WORDING stays here where it belongs.
   *
   * ⚠ **ABSENT OR `0` DROPS THE FIGURE, NEVER GUESSES ONE.** An older server
   * sends no such key — every field on this interface is optional because the
   * wire makes it so — and a made-up allowance in an upsell is worse than an
   * upsell without one. It is NOT `limit`: that is the caller's CURRENT
   * allowance, which is the number they just exhausted.
   */
  upgradeCredits?: number;
}

/** `2026-09-01T00:00:00.000Z` → `2026-09-01`, or null when it is not a date.
 *  ⚠ Null OMITS the "Resets …" sentence; printing `Invalid Date` or a raw
 *  fragment of somebody's shape change is worse than saying nothing. */
function periodEndDate(periodEnd: string | undefined): string | null {
  if (typeof periodEnd !== "string") return null;
  const day = periodEnd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return Number.isNaN(Date.parse(periodEnd)) ? null : day;
}

/**
 * ` for 5,000`, or `""` when the server sent no figure.
 *
 * ⚠ **THE WHOLE CLAUSE GOES, NOT JUST THE NUMBER.** The callers below append
 * this to `Upgrade to Team` / `Upgrade to Pro`, so an empty return leaves
 * *"Upgrade to Team: <url>"* — a shorter true sentence. Keeping the preposition
 * and dropping the figure would leave *"for credits per member"*, which is the
 * fabricated-denominator failure `usage-meter.tsx` records, in prose.
 * ⚠ `0` IS "NO OFFER TO SIZE", not an allowance of zero: both degraded answers
 * send it (`credits-meter.ts › unmetered`, the consume route's `failOpen`).
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
 * Credits refusal rendered exactly like an entitlement denial (message +
 * upgrade link) so an agent reads ONE shape for every plan gate. ⚠ URL comes
 * from the server's consume response — this package cannot import
 * `billing/server/entitlements.ts › upgradeUrl`.
 *
 * ⚠ **THE SENTENCE NAMES WHOSE COUNTER STOPPED, BECAUSE NOTHING IS POOLED**
 * (Samuel, 2026-09-07). A `seat` refusal is about the caller's OWN allocation
 * inside that workspace — telling them "this workspace is out" would send them
 * to an admin who cannot help — and a `personal` refusal is about their home
 * space.
 *
 * ⚠ **THE UPGRADE LINE IS DECIDED BY THE URL, NEVER BY THE WALLET** (Samuel,
 * 2026-09-08: a personal PRO tier exists now). BOTH wallets carry an upsell on
 * a FREE verdict and neither carries one on a PAID one, so an empty
 * `upgradeUrl` is the server saying there is nothing to buy — the only fact
 * this package can know. A wallet-keyed "personal never upgrades" rule was
 * true for one day, and it would hide the paid tier on the product's primary
 * agent surface while the server was handing this function the link.
 *
 * ⚠ **A MISSING `wallet` FALLS BACK, IT DOES NOT GUESS.** An older server omits
 * the field entirely and `null` is the unmetered posture; both render the
 * generic sentence, which is true of every wallet.
 */
export function creditsExhausted(o: CreditsOutcome): ToolResponse {
  const url = typeof o.upgradeUrl === "string" ? o.upgradeUrl : "";
  const span = usageSpan(o.used, o.limit);
  const day = periodEndDate(o.periodEnd);
  const resets = day ? ` Resets ${day}.` : "";

  if (o.wallet === "seat") {
    const head = `Your seat in this workspace is out of credits for this period${span}.${resets}`;
    // ⚠ THE FIGURE COMES OFF THE WIRE, NOT OUT OF A LITERAL (F-668).
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

/**
 * Plan-gate denial (403, flat entitlement envelope) → tool error, else null so
 * the caller rethrows. ⚠ Duck-typed on `.code`/`.apiMessage`/`.upgradeUrl` to
 * work across the module boundary. Surfaces the server's human message and
 * upgrade link VERBATIM, not a generic "request failed".
 */
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

/**
 * Error response when any `required` param is absent for this op, else null.
 * ⚠ undefined / null / empty-string all count as absent. Lets one flat schema
 * back many ops while still rejecting under-specified calls clearly.
 */
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
  // ⚠ THE `reason=` LITERAL IS THE POINT. `tool-errors.ts` declares it once,
  // every tool's description teaches it, and this is the wire. Wording the
  // refusal by hand here is how the two spellings drift apart.
  return err(
    refusal(MISSING_PARAMS, `op="${op}" is missing required ${plural}: ${missing.join(", ")}.`),
  );
}
