/**
 * THE AGENT INSTANCE ID, NORMALIZED — **the one parser three ops share**.
 *
 * ⚠ **EXTRACTED FROM `channel-ops-direct.ts` ON 2026-09-01**, when `end_agent` and
 * `rename_agent` landed and became its second and third callers. It is four
 * characters of logic and that is exactly why it had to move: a copy would be
 * four characters that agree today, and the day one of them stops accepting the
 * pasted `@agent-` form is the day a caller is 400'd for doing what the
 * neighbouring op taught it.
 */
/**
 * THE BARE INSTANCE ID, from whichever form the caller pasted.
 *
 * ⚠ **BOTH FORMS ARE ACCEPTED BECAUSE `read_sessions` PRINTS THE HANDLE, NOT THE
 * ID.** Every surface that shows an agent over MCP shows `@agent-<id>`, so that is
 * what a model copies — and the column CHECK and the create schema both want the
 * bare eight characters. Refusing the pasted form would be a 400 for doing exactly
 * what the neighbouring op taught, which is the invisible-failure shape this
 * surface refuses everywhere else.
 * ⚠ IT STRIPS, IT DOES NOT VALIDATE. A value that is not an agent id after this
 * is refused by the create schema and, failing that, reaches a machine that
 * answers `no-session` — both honest, and neither is this function's job.
 */
export declare function bareAgentId(raw: string): string;
