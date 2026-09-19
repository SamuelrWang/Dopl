/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */
import { z, type ZodRawShape } from "zod";
/** A tool result: text blocks, plus the error flag. */
export type ToolResponse = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
export type RegisterTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>) => void;
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
export type RegisterMetaTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>, opts?: MetaToolOptions) => void;
export declare function ok(text: string): ToolResponse;
export declare function err(message: string): ToolResponse;
/**
 * True for an optimistic-concurrency conflict (HTTP 412). ⚠ Duck-typed on
 * `.status` to work across the @dopl/client boundary without importing the
 * error class.
 */
export declare function isConflict(e: unknown): boolean;
/** True for a 404. Same duck-typing as `isConflict`. */
export declare function isNotFound(e: unknown): boolean;
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
export declare function isApiError(e: unknown, status: number, code: string): boolean;
/**
 * The SERVER's own human sentence off an api error, or null when it sent none.
 * ⚠ Prefer it over a hand-written one wherever it exists: the server knows which
 * credential class or gate refused, and this layer does not.
 */
export declare function apiMessage(e: unknown): string | null;
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
export declare function sessionRequired(e: unknown, op: string): ToolResponse | null;
/** True for a 409 (name/title/slug already-exists collision). */
export declare function isAlreadyExists(e: unknown): boolean;
/**
 * Credit allowance spent for the billing period. ⚠ ONE wording for both
 * surfaces: the registrar's up-front refusal (reading `allowed: false` off the
 * consume response, not an error) and `entitlementDenied` below.
 */
export declare const CREDITS_EXHAUSTED_CODE: string;
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
export declare function creditsExhausted(o: CreditsOutcome): ToolResponse;
/**
 * Plan-gate denial (403, flat entitlement envelope) → tool error, else null so
 * the caller rethrows. ⚠ Duck-typed on `.code`/`.apiMessage`/`.upgradeUrl` to
 * work across the module boundary. Surfaces the server's human message and
 * upgrade link VERBATIM, not a generic "request failed".
 */
export declare function entitlementDenied(e: unknown): ToolResponse | null;
/**
 * Error response when any `required` param is absent for this op, else null.
 * ⚠ undefined / null / empty-string all count as absent. Lets one flat schema
 * back many ops while still rejecting under-specified calls clearly.
 */
export declare function missingParams(op: string, args: Record<string, unknown>, required: string[]): ToolResponse | null;
