/**
 * PARTIAL READS — "returned nothing" and "could not ask" are not the same fact.
 *
 * `dopl_map` and `dopl_search` each fan out across four or five domains and
 * wrap every one in `.catch(() => [])`. The fail-soft half is right: one broken
 * domain must not fail the whole call, and an agent that gets four of five
 * sections is better off than one that gets an error. What was wrong is that
 * the RESULT then asserted a fact the code never established — a knowledge
 * service returning 500 rendered as `_None._` under "Knowledge bases", and an
 * agent read the workspace as empty. Two agents did exactly that.
 *
 * So the catch stays and the SILENCE goes: a domain that could not be read is
 * named on the result, in the scope footer the reader already meets, with a
 * short cause.
 *
 * WHY THE CAUSE IS OUR OWN VOCABULARY AND NOT THE ERROR'S MESSAGE. A
 * `DoplApiError`'s message is the API's body — for a 500 that can be a Postgres
 * error carrying SQL, a column list, or a constraint name. None of that helps
 * an agent decide what to do next, and all of it is internals in a string the
 * model will happily repeat to the user. `causeOf` maps the error onto a fixed
 * set of short phrases instead: enough to tell a permissions problem from an
 * outage, nothing that leaks the inside of the server.
 *
 * ONE definition, both tools. Two copies of a "some of this is missing" notice
 * drift, and the copy that drifts is the one that stops warning.
 */
/**
 * A short, safe cause. Deliberately a small closed vocabulary: an HTTP status
 * (the one detail that separates "you may not" from "it is broken"), or the
 * transport failure mode. Never the response body, never `e.message`.
 */
export declare function causeOf(e: unknown): string;
export interface PartialRead {
    /**
     * Run one domain read fail-soft. On failure the domain is recorded and
     * `fallback` is used, so the rest of the result still renders.
     */
    soft<T>(domain: string, read: Promise<T>, fallback: T): Promise<T>;
    /**
     * The notice, or `""` when every read answered — so the healthy result is
     * byte-for-byte what it was before this existed. Ends with a trailing space
     * because it PREFIXES the scope footer rather than adding a second line: the
     * warning that matters most should be the first thing in the footer, and a
     * reader who skims one italic line must not be able to skim past it.
     */
    notice(total: number, noun: string): string;
}
export declare function partialRead(): PartialRead;
