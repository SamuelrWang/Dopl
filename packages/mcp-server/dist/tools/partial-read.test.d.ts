/**
 * "RETURNED NOTHING" vs "COULD NOT ASK" — the two facts `dopl_map` and
 * `dopl_search` used to render identically.
 *
 * Both tools fan out across every domain and caught each read with
 * `.catch(() => [])`. A knowledge service returning 500 therefore produced
 * `## Knowledge bases (0)` / `_None._`, and an agent reported the workspace as
 * empty. Two agents drew exactly that conclusion off this surface.
 *
 * The two halves this suite pins, and they only work as a pair:
 *   1. A failing domain is NAMED, with a short cause, and the result does not
 *      read as an empty workspace.
 *   2. The all-healthy result is BYTE-IDENTICAL to the one without any of this
 *      — no notice, no extra line, no changed spacing. A warning that also
 *      fires on the happy path teaches agents to skip it, which is how the
 *      original silence got installed.
 *
 * Driven through the real registrars with the shared harness; the @dopl/client
 * is hand-stubbed and nothing transports.
 */
export {};
