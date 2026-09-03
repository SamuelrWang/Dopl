/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */

import { z, type ZodRawShape } from "zod";
import { CREDITS_EXHAUSTED, MISSING_PARAMS, refusal } from "./tool-errors";

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

/** True for a 409 (name/title/slug already-exists collision). */
export function isAlreadyExists(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 409
  );
}

/**
 * MCP credit allowance spent for the billing period. ⚠ ONE wording for both
 * surfaces: the registrar's up-front refusal (reading `allowed: false` off the
 * consume response, not an error) and `entitlementDenied` below.
 */
export const CREDITS_EXHAUSTED_CODE = CREDITS_EXHAUSTED.reason;

// ⚠ THE `reason=` PREFIX IS ADDITIVE AND THE SENTENCE IS NOT REPEATED (A14).
// `credits.test.ts` pins "out of MCP credits", which the CODE's own meaning now
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
 * Credits refusal rendered exactly like an entitlement denial (message +
 * upgrade link) so an agent reads ONE shape for every plan gate. ⚠ URL comes
 * from the server's consume response — this package cannot import
 * `billing/server/entitlements.ts › upgradeUrl`.
 */
export function creditsExhausted(upgradeUrl: string): ToolResponse {
  return err(
    upgradeUrl
      ? `${CREDITS_EXHAUSTED_MESSAGE}\n\nUpgrade to continue: ${upgradeUrl}`
      : CREDITS_EXHAUSTED_MESSAGE
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
        ? "This chat is older than the free plan's history window. Nothing was deleted — upgrade to Pro to restore full chat history."
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
