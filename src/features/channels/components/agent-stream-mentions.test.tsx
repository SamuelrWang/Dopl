// @vitest-environment jsdom
/**
 * **@-HANDLES TINT IN THE AGENT VIEW** (Samuel, 2026-10-12: *"@-mention slugs — e.g.
 * @cleanup-orchestrator, @samuel-wang — currently render in plain black text. Make them blue"*;
 * ruling 2a, *give both agent hosts a real roster*).
 *
 * ⚠ **THE RENDERER WAS NEVER THE PROBLEM, AND THAT IS THE POINT OF THIS FILE.** The agent stream
 * has gone through the TRANSCRIPT's markdown renderer since 2026-08-31 (R1: reuse it, do not fork
 * it), mention leaf included. What it lacked was a ROSTER: the tint is gated on RESOLUTION, so
 * `agent-stream-prose.tsx` passed an empty index and every handle rendered as its own characters.
 * The fix is the index arriving from the host (`StreamRoster`), NOT a second parser and NOT a tint
 * on unresolved tokens — F-266 is the rule being kept, not bent: a tint asserts that the roster
 * resolved somebody, and the server's stamp and a tint must never disagree about who was tagged.
 *
 * So every property below is about WHICH strings reach the mention leaf with a roster behind them:
 *
 *  - **A RESOLVED HANDLE TINTS** — a member's and an agent's, the two namespaces.
 *  - **AN EMAIL DOES NOT.** `sam@example.com` used to yield the handle `example.com` (F-706); the
 *    boundary `(?<![A-Za-z0-9])@` exists for exactly this, and an address tinted as a tag tells the
 *    operator somebody was notified.
 *  - **CODE DOES NOT TAG** (`mentions.ts` rule 6 / `mentions-mask.ts`): a handle inside a fence or
 *    an inline code span names nobody, and the renderer's `code` / `codespan` arms never reach the
 *    mention leaf at all.
 *  - **NO ROSTER, NO TINT.** A host that supplies none renders exactly what it rendered before this
 *    wave — the honest claim for a surface that did not ask.
 *  - **AN UNRESOLVED HANDLE STAYS PLAIN** — an ended agent, a typo, somebody outside this channel.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AgentStream } from "./agent-stream";
import { indexMembers } from "./view-model";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { ME, member } from "./test-fixtures";

afterEach(cleanup);

const AGENT_A = "a1b2c3d4";

/** Members AND this operator's agents — the index the host hands the stream. */
function roster() {
  return indexMembers(
    [member({ userId: ME, displayName: "Samuel Wang" })],
    ME,
    new Map([[AGENT_A, { displayName: "Cleanup Orchestrator", description: null }]])
  );
}

/** One arriving message carrying `text` — the lane whose body a member actually wrote. */
function frame(text: string): AgentNarrationEntry {
  return {
    at: 1_000,
    kind: "inbound",
    lane: "inbound",
    text,
    senderName: "Diana Taylor",
  } as unknown as AgentNarrationEntry;
}

/** The tinted tokens, in order — `span.text-link` is this tree's established vocabulary for a
 *  mention tint (`message-markdown.test.tsx` reads it the same way). */
function tints(text: string, withRoster = true): string[] {
  const view = render(
    <AgentStream
      entries={[frame(text)]}
      supported
      sent={[]}
      roster={withRoster ? roster() : null}
    />
  );
  return [...view.container.querySelectorAll("span.text-link")].map((n) => n.textContent ?? "");
}

describe("the agent stream tints @-handles once its host has a roster", () => {
  it("tints a MEMBER's handle and an AGENT's — the two namespaces", () => {
    expect(tints("@samuel-wang please look, cc @cleanup-orchestrator")).toEqual([
      "@samuel-wang",
      "@cleanup-orchestrator",
    ]);
  });

  it("🔒 NEVER tints an email address", () => {
    // F-706: the `@` inside a word is not a tag. An address painted as a tag would tell the
    // operator a person had been notified when nothing resolved at all.
    expect(tints("mail samuelnywang717@gmail.com and sam@example.com")).toEqual([]);
    // ⚠ AND THE CONTROL: the same body with a real handle in it tints ONLY the handle.
    expect(tints("mail sam@example.com, then ping @samuel-wang")).toEqual(["@samuel-wang"]);
  });

  it("🔒 leaves a handle inside CODE alone, inline and fenced", () => {
    // Code is QUOTED (`mentions.ts` rule 6): the renderer's `codespan` / `code` arms render their
    // own text and never reach the mention leaf, so neither spelling may tint.
    expect(tints("run `dopl send @samuel-wang` first")).toEqual([]);
    expect(tints("```\nto: @cleanup-orchestrator\n```")).toEqual([]);
    // ⚠ THE CONTROL AGAIN: outside the backticks the same token tints.
    expect(tints("`@samuel-wang` vs @samuel-wang")).toEqual(["@samuel-wang"]);
  });

  it("tints NOTHING when the host has no roster — the pre-2026-10-12 face, kept", () => {
    expect(tints("@samuel-wang and @cleanup-orchestrator", false)).toEqual([]);
  });

  it("leaves an UNRESOLVED handle plain — it addresses nobody and must not look like it does", () => {
    expect(tints("@nobody-here and @agent-zzzzzzzz, plus @samuel-wang")).toEqual([
      "@samuel-wang",
    ]);
  });

  it("tints inside a bold run and keeps the author's trailing punctuation", () => {
    // ⚠ THE PARITY CASE F-266 WAS FOUND ON (`lib/mentions-tint-parity.test.ts`): markdown decides
    // which strings reach the leaf, and `**@handle**` must tint like a bare one — while a trailing
    // comma belongs to the author's sentence, not to the handle.
    expect(tints("**@samuel-wang**, now")).toEqual(["@samuel-wang"]);
  });
});
