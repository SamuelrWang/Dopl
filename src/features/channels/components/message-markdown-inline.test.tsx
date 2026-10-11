// @vitest-environment jsdom
/**
 * **THE PREVIEW ARM — inline markdown with the blocks left out** (Samuel, 2026-10-10,
 * #3128: the main chat area printed `**asterisks**` where the agent panel showed bold).
 *
 * The properties pinned here are the ones whose failure is invisible or arrives as a
 * layout bug nobody traces back to a renderer:
 *
 *  - **EMPHASIS RENDERS, AND IT IS THE BLOCK RENDERER'S OWN.** The whole point of the arm
 *    is that there is no second emphasis rule, no second code face and no second link
 *    policy — so a `<strong>` here is the one `message-markdown.tsx › Inline` builds.
 *  - **BLOCK MARKERS STAY AS CHARACTERS, ON PURPOSE.** These lanes are clamped
 *    (`line-clamp-2` / `line-clamp-3`) and a `line-clamp` does not clamp a container of
 *    sibling blocks, so a preview that lexed into paragraphs would push its card open.
 *    A `#`, a `-` and a fence therefore print. **If this ever starts returning blocks,
 *    nothing fails loudly — a thread card just quietly grows.**
 *  - **NO HTML REACHES THE DOM AS MARKUP**, the block renderer's rule 1, which must hold
 *    on a preview of an untrusted body exactly as it holds on the body.
 *  - **THE MENTION LEAF IS REACHED THROUGH IT**, so a resolved handle tints and a handle
 *    inside a code span does NOT — which is the F-266 divergence the Tags inbox used to
 *    confess, closed by routing the snippet through a lexer at all.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { bodyContextOf } from "./message-markdown";
import { MessageMarkdownInline } from "./message-markdown-inline";
import { indexMembers } from "./view-model";
import { member, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

function renderInline(text: string, mentionsMe = false) {
  return render(
    <MessageMarkdownInline
      text={text}
      ctx={bodyContextOf({ index: INDEX, mentionsMe })}
    />
  );
}

describe("the inline arm renders emphasis", () => {
  it("makes bold, italic and strikethrough into elements, not asterisks", () => {
    const { container } = renderInline("a **bo** and *it* and ~~no~~");
    expect(container.querySelector("strong")?.textContent).toBe("bo");
    expect(container.querySelector("em")?.textContent).toBe("it");
    // GFM is on for the same reason the block arm has it: a `~~word~~` that struck
    // through in the transcript and not in its own preview is two readings of one body.
    expect(container.querySelector("del")?.textContent).toBe("no");
    expect(container.textContent).not.toContain("**");
  });

  it("renders a code span as code, and a link as an anchor", () => {
    const { container } = renderInline("run `npm ci` see [docs](https://example.com/d)");
    expect(container.querySelector("code")?.textContent).toBe("npm ci");
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toContain("https://example.com/d");
  });

  it("refuses an unsafe href and keeps the words — the block arm's own policy", () => {
    const { container } = renderInline("[tap](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("tap");
  });
});

describe("it produces no blocks, which is what keeps a clamp a clamp", () => {
  it("leaves a heading marker, a bullet and a fence as characters", () => {
    const { container } = renderInline("# Heading\n- one\n```\ncode\n```");
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    // The characters survive: a preview is a FRAGMENT, and claiming structure for it
    // would claim something the clamp cut away.
    expect(container.textContent).toContain("# Heading");
    expect(container.textContent).toContain("- one");
  });

  it("wraps the run in no box of its own — the caller's element is the only one", () => {
    const { container } = renderInline("plain words");
    // A fragment of inline leaves: whatever BOX the text sits in came from the caller (a
    // clamped `<p>` on a thread card, a centred `<p>` on a system row), never from here.
    // That is what lets a caller keep its own clamp, centring and type.
    expect(container.querySelector("p, div, ul, ol, pre, blockquote, table")).toBeNull();
    expect(container.textContent).toBe("plain words");
  });
});

describe("untrusted text, and the mention leaf behind it", () => {
  it("prints HTML as its own characters", () => {
    const { container } = renderInline("hello <b>not bold</b> <img src=x onerror=1>");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<b>not bold</b>");
  });

  // The roster's own spelling, exactly as `message-markdown.test.tsx` writes it.
  const HANDLE = "@dianataylor";

  it("tints a resolved handle, including inside a bold run", () => {
    const { container } = renderInline(`**${HANDLE}** shipped it`);
    const tinted = screen.getByText(HANDLE);
    expect(tinted.className).toContain("text-link");
    // Inside the bold, not beside it: the leaf splits a TEXT token, so markdown
    // structure cannot break a mention and a mention cannot break the markup.
    expect(container.querySelector("strong")?.textContent).toContain(HANDLE);
  });

  it("does NOT tint a handle inside a code span — the closed F-266 divergence", () => {
    renderInline(`write \`${HANDLE}\` to tag her`);
    const token = screen.getByText(HANDLE);
    expect(token.tagName).toBe("CODE");
    expect(token.className).not.toContain("text-link");
  });

  it("leaves a handle the roster cannot resolve as plain prose", () => {
    const { container } = renderInline("@nobody-here said so");
    expect(container.querySelector(".text-link")).toBeNull();
    expect(container.textContent).toContain("@nobody-here");
  });
});
