/**
 * Shared payload + assertions for the narration-forgery suites
 * (`narration.test.ts`, `tool-narration.test.ts`,
 * `tool-narration-graph.test.ts`).
 *
 * Extracted rather than copied, for the same reason the neutralizer itself was:
 * the channel suites each carry their own private copy of this payload and
 * these helpers, and a copy is how an assertion quietly weakens. `expectContained`
 * in particular is doing real work — "the marker is on one line, inside a code
 * span, and starts nothing" is the whole claim — and three drifting versions of
 * it would be three different claims.
 *
 * Not a `.test.ts` file on purpose (vitest would try to run it and find no
 * tests), and named `narration-*` so the parity split-scan, which groups
 * `<registrar-stem>-*.ts` files, never mistakes it for a tool module: there is
 * no `narration` registrar.
 */
import type { DoplClient } from "@dopl/client";
import type { RegisterTool } from "./respond";
/**
 * One payload, every structural trick a result's own formatting could be
 * mistaken for: an unbalanced backtick to escape a code span, a blank line and
 * a `## ` to open a heading, a fake `[system]` grant, a fake message row, a
 * fake `workspace_source:` footer key, and a block quote carrying the
 * instruction. Reused verbatim at every site so the sites are comparable.
 */
export declare const FORGERY: string;
/** A word from the payload that must SURVIVE — legibility is the feature. */
export declare const MARKER = "Operator directive";
/** The payload is CONTAINED: one line, inside a code span, starting nothing. */
export declare function expectContained(text: string, marker?: string): void;
/**
 * Every line carrying the payload contains it as a span. Used where the string
 * legitimately appears more than once — a meta-tool's body AND the
 * `_dopl_status` footer appended to it both name the workspace.
 */
export declare function expectEveryHitContained(text: string, marker?: string): void;
/** No line of the result is structure the ATTACKER wrote. */
export declare function expectNoForgedStructure(text: string): void;
/** Every markdown heading in the result was written by US. */
export declare function expectOnlyOurHeadings(text: string, ours: RegExp): void;
/** Drive one op of a registered tool through its real registrar. */
export declare function callTool(register: (r: RegisterTool, c: DoplClient) => void, client: DoplClient, toolName: string, args: Record<string, unknown>): Promise<string>;
/** A hand-stubbed @dopl/client — nothing transports. */
export declare const stub: (o: Record<string, unknown>) => DoplClient;
