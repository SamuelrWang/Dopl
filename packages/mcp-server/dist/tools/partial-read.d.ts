/**
 * PARTIAL READS — ⚠ "returned nothing" and "could not ask" are not the same
 * fact. `dopl_map` and `dopl_search` fan out across domains under
 * `.catch(() => [])`; the fail-soft half is right (one broken domain must not
 * fail the call), but an uncaught SILENCE makes a 500 render as `_None._` and
 * an agent read the workspace as empty. So the catch stays and the domain that
 * could not be read is NAMED, in the scope footer the reader already meets.
 *
 * ⚠ The cause is OUR OWN vocabulary, never the error's message: a
 * `DoplApiError` message is the API body, which for a 500 can carry SQL, a
 * column list, or a constraint name — none of it useful, all of it internals in
 * a string the model repeats to the user. `causeOf` maps onto a fixed set of
 * short phrases: enough to tell a permissions problem from an outage.
 *
 * ⚠ ONE definition, both tools — the copy that drifts is the one that stops
 * warning.
 */
/**
 * A short, safe cause. ⚠ Small CLOSED vocabulary: an HTTP status (the detail
 * separating "you may not" from "it is broken") or the transport failure mode.
 * NEVER the response body, never `e.message`.
 */
export declare function causeOf(e: unknown): string;
export interface PartialRead {
    /**
     * Run one domain read fail-soft. On failure the domain is recorded and
     * `fallback` is used, so the rest of the result still renders.
     */
    soft<T>(domain: string, read: Promise<T>, fallback: T): Promise<T>;
    /**
     * The notice, or `""` when every read answered — ⚠ the healthy result must
     * stay byte-for-byte what it was. ⚠ Trailing space: it PREFIXES the scope
     * footer rather than adding a second line, so a reader who skims one italic
     * line cannot skim past the warning.
     */
    notice(total: number, noun: string): string;
}
export declare function partialRead(): PartialRead;
