// @vitest-environment jsdom
/**
 * MESSAGE BODIES RENDER AS MARKDOWN (Samuel, 2026-08-21) — and the properties
 * pinned here are the ones whose failure is INVISIBLE in a screenshot.
 *
 *  - **NO HTML EVER REACHES THE DOM AS MARKUP.** Bodies are authored by other
 *    members and by their agents. The renderer maps TOKENS to React elements and
 *    never produces an HTML string, so `<script>` is characters. A regression
 *    here does not look broken — it looks like nothing, right up until it is a
 *    stored XSS in every member's transcript.
 *  - **ONLY SAFE PROTOCOLS BECOME LINKS.** `javascript:` and `data:` parse
 *    perfectly well as URLs, so "does it parse" is no check at all. An href that
 *    is refused loses the ANCHOR and keeps the WORDS.
 *  - **MENTIONS TINT AT THE TEXT LEAF, so markdown cannot break them.** A handle
 *    inside a heading, a bullet or a bold run is still a mention; a handle in a
 *    CODE SPAN is deliberately not, because code is quoted text.
 *  - **THE LAYOUT CONTRACT SURVIVES.** A paragraph is still a `<p>` wearing the
 *    body recipe, which is what `transcript-body.test.tsx`'s pins measure — this
 *    file guards the same classes from the renderer's side.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageMarkdown } from "./message-markdown";
// ⚠ THE LINK POLICY IS ITS OWN MODULE since 2026-08-22, split on the SECURITY
// seam when the GFM task-list case pushed the renderer to the 500-line cap
// (F-252). The cases below did not move and did not change — only the import.
import { safeHref } from "./message-markdown-links";
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

function renderBody(text: string, mentionsMe = false) {
  return render(
    <MessageMarkdown
      text={text}
      index={INDEX}
      mentionsMe={mentionsMe}
      blockClassName="wrap-anywhere max-w-[92%]"
      textClassName="text-lead text-text-primary"
    />
  );
}

describe("safeHref — a positive allow-list, not a parse check", () => {
  it("passes the three protocols a message may link to", () => {
    expect(safeHref("https://example.com/a")).toContain("https://example.com/a");
    expect(safeHref("http://example.com")).toContain("http://example.com");
    expect(safeHref("mailto:sam@example.com")).toContain("mailto:sam@example.com");
  });

  it("refuses every scheme that parses but must not be followed", () => {
    // ⚠ Each of these is a VALID URL. A `new URL()` in a try/catch would admit
    // all four, which is exactly why the check is an allow-list.
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)  ",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
    ]) {
      expect(safeHref(href)).toBeNull();
    }
  });

  it("refuses relative and empty hrefs — a transcript is not a document", () => {
    for (const href of ["/settings", "#top", "", "   ", null, undefined]) {
      expect(safeHref(href)).toBeNull();
    }
  });
});

describe("the untrusted body cannot inject markup", () => {
  it("renders a script tag as CHARACTERS, with no script element anywhere", () => {
    const { container } = renderBody("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders INLINE html as characters too", () => {
    const { container } = renderBody("hello <b>not bold</b> there");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>not bold</b>");
  });

  it("never renders an img element, however the body asks for one", () => {
    const { container } = renderBody(
      "![x](https://tracker.example/pixel.png)\n\n<img src=\"https://tracker.example/p.png\">"
    );
    // ⚠ A remote image in a message body is a read receipt and an IP
    // disclosure for every member who scrolls past it, fetched before anybody
    // chose to look. The link is offered; nothing is fetched.
    expect(container.querySelector("img")).toBeNull();
  });

  it("drops the ANCHOR and keeps the WORDS on an unsafe link", () => {
    const { container } = renderBody("[click me](javascript:alert(1))");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("links a safe href externally, with the app's own rel", () => {
    renderBody("[docs](https://example.com/docs)");
    const anchor = screen.getByText("docs").closest("a") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toContain("https://example.com/docs");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toContain("noopener");
    expect(anchor.getAttribute("rel")).toContain("noreferrer");
  });
});

describe("the marks a chat body actually uses", () => {
  it("renders bold, italic and strikethrough as elements, not asterisks", () => {
    const { container } = renderBody("**bo** and *it* and ~~gone~~");
    expect(container.querySelector("strong")?.textContent).toBe("bo");
    expect(container.querySelector("em")?.textContent).toBe("it");
    expect(container.querySelector("del")?.textContent).toBe("gone");
    expect(container.textContent).not.toContain("**");
  });

  it("renders inline code and a fenced block, the block scrolling", () => {
    const { container } = renderBody("use `npm ci`\n\n```js\nconst a = 1;\n```");
    expect(screen.getByText("npm ci").tagName).toBe("CODE");
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.textContent).toContain("const a = 1;");
    // ⚠ Code SCROLLS rather than wraps — wrapping changes what it says.
    expect(pre.className).toContain("overflow-x-auto");
    expect(pre.className).not.toContain("wrap-anywhere");
    expect(pre.querySelector("code")?.className).toContain("font-mono");
  });

  it("renders bullet and ordered lists", () => {
    const { container } = renderBody("- one\n- two\n\n1. first\n2. second");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(screen.getByText("first")).toBeTruthy();
  });

  /**
   * ⚠ A GFM TASK LIST IS THE SHAPE AGENTS WRITE PLANS IN, and it rendered broken
   * on every item until 2026-08-22 (F-252). `marked@18` emits the checkbox as
   * its OWN token, the first child of the item's `tokens`; it fell to the
   * renderer's `default` arm, which wraps an unhandled token in a `<p>` to keep
   * the author's words — so each item became a BLOCK reading `[ ]` followed by
   * a second line with the text.
   */
  it("keeps a task-list marker on the item's own line, as a symbol", () => {
    const { container } = renderBody("- [ ] not done\n- [x] done");
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // The literal source characters are gone from the rendering…
    expect(container.textContent).not.toContain("[ ]");
    expect(container.textContent).not.toContain("[x]");
    // …replaced by a marker with a REAL label, on the item, beside its words.
    expect(items[0].querySelector('[aria-label="not done"]')).toBeTruthy();
    expect(items[1].querySelector('[aria-label="done"]')).toBeTruthy();
    expect(items[0].textContent).toContain("not done");
    // ⚠ THE ITEM IS ONE BLOCK. A `<p>` inside it is the defect itself — that is
    // what split every checklist row across two lines.
    expect(items[0].querySelector("p")).toBeNull();
    expect(items[1].querySelector("p")).toBeNull();
  });

  it("renders headings modestly — a bold line, never a banner", () => {
    const { container } = renderBody("# Title\n\nbody");
    const heading = screen.getByText("Title").closest("p") as HTMLElement;
    expect(heading.className).toContain("font-semibold");
    // The document scale has no business in a transcript row.
    expect(container.innerHTML).not.toMatch(/text-(2xl|3xl|4xl)/);
  });

  it("renders a blockquote and a GFM table", () => {
    const { container } = renderBody("> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted");
    expect(container.querySelectorAll("table th")).toHaveLength(2);
    expect(container.querySelectorAll("table td")).toHaveLength(2);
  });

  it("keeps a member's words when a token type is not one it draws", () => {
    // ⚠ An unhandled token renders its own source rather than nothing —
    // silently deleting somebody's sentence is the worse failure.
    const { container } = renderBody("---\n\n[ref]: https://example.com\n");
    expect(container.textContent).toContain("[ref]: https://example.com");
  });
});

describe("mentions compose with markdown rather than breaking inside it", () => {
  const HANDLE = "@dianataylor";

  it("tints a mention in plain prose", () => {
    renderBody(`hey ${HANDLE} look`);
    expect(screen.getByText(HANDLE).className).toContain("text-link");
  });

  it("tints one inside a bold run, a bullet and a heading", () => {
    for (const body of [`**${HANDLE}**`, `- ${HANDLE}`, `## ${HANDLE}`]) {
      const view = render(
        <MessageMarkdown text={body} index={INDEX} mentionsMe={false} />
      );
      expect(screen.getByText(HANDLE).className).toContain("text-link");
      view.unmount();
    }
  });

  it("does NOT tint one inside a code span — code is quoted text", () => {
    renderBody(`run \`${HANDLE}\` literally`);
    const token = screen.getByText(HANDLE);
    expect(token.tagName).toBe("CODE");
    expect(token.className).not.toContain("text-link");
  });

  it("adds the viewer's own highlight only when the SERVER stamp agrees", () => {
    const mine = "@samwang";
    renderBody(`ping ${mine}`, true);
    expect(screen.getByText(mine).className).toContain("bg-link/10");
    cleanup();
    // ⚠ Same token, no stamp: the tint stays, the highlight does not. The
    // stamp alone cannot place a highlight and the token alone is a
    // re-derivation of a fact the server already settled.
    renderBody(`ping ${mine}`, false);
    expect(screen.getByText(mine).className).toContain("text-link");
    expect(screen.getByText(mine).className).not.toContain("bg-link/10");
  });
});

describe("the layout contract the transcript pins", () => {
  it("puts the caller's block AND text recipe on a paragraph, in that order", () => {
    renderBody("plain words");
    const p = screen.getByText("plain words").closest("p") as HTMLElement;
    expect(p.className).toContain("wrap-anywhere");
    expect(p.className).toContain("max-w-[92%]");
    expect(p.className).toContain("text-lead");
    // ⚠ THE COLOUR MUST SURVIVE. `cn` collapses this tree's `text-lead` SIZE
    // with a `text-*` COLOUR into one group, so a heading recipe merged onto
    // the body recipe drops one of them — which is why the two halves arrive
    // as separate props and no block is handed a class it must win against.
    expect(p.className).toContain("text-text-primary");
  });

  it("caps a top-level list and code block, and does NOT re-cap nested blocks", () => {
    const { container } = renderBody("- a paragraph in a list\n\n```\ncode\n```");
    expect((container.querySelector("ul") as HTMLElement).className).toContain(
      "max-w-[92%]"
    );
    expect((container.querySelector("pre") as HTMLElement).className).toContain(
      "max-w-[92%]"
    );
    // A block inside a list item is already inside a capped box; capping it
    // again at 92% of its PARENT would step the indent in twice.
    for (const el of container.querySelectorAll("li *")) {
      expect(el.className).not.toContain("max-w-[92%]");
    }
  });
});

/**
 * AGENT MENTIONS TINT LIKE MEMBER MENTIONS (Samuel, 2026-08-27).
 *
 * ⚠ A SEPARATE NAMESPACE, DECIDING TINT ONLY. `metadata.mentionedUserIds` is the SERVER's stamped
 * set and resolves against the channel ROSTER — an agent is not a member, that resolver correctly
 * answers nobody, and it must go on doing so. What is rendered here is a local reading of THIS
 * machine's own agents; the routing verdict is main's (`session-dispatch.js › mentionedAgentIds`,
 * which accepts the same two shapes).
 */
describe("agent mentions", () => {
  const AGENT = "k3v7d2mq";
  const withAgents = (displayName: string | null) =>
    indexMembers(
      [
        member({ userId: ME, displayName: "Sam Wang" }),
        member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
      ],
      ME,
      new Map([[AGENT, { displayName, description: null }]])
    );

  const tinted = (text: string, displayName: string | null = null) => {
    const view = render(
      <MessageMarkdown text={text} index={withAgents(displayName)} mentionsMe={false} />
    );
    return [...view.container.querySelectorAll("span.text-link")].map((n) => n.textContent);
  };

  it("tints `@agent-<id>` blue — the id form every agent always answers to", () => {
    expect(tinted(`hey @agent-${AGENT} take this`)).toEqual([`@agent-${AGENT}`]);
  });

  it("tints the agent's SLUGGED custom name, on the same convention as a member's", () => {
    // ⚠ ONE SLUGGER (`lib/mentions.ts › mentionSlug`), so "Research Bot" spells the same way a
    // roster name does. A second `.replace(/\s+/g, "-")` anywhere is how the two would drift.
    expect(tinted("ping @research-bot please", "Research Bot")).toEqual(["@research-bot"]);
    // ⚠ AND THE ID FORM IS NEVER WITHDRAWN BY A RENAME — an address already written keeps working.
    expect(tinted(`ping @agent-${AGENT}`, "Research Bot")).toEqual([`@agent-${AGENT}`]);
  });

  it("leaves an unknown agent handle as plain prose", () => {
    // ⚠ INTERSECTED WITH THIS MACHINE'S LIVE AGENTS, exactly as main's parser is. A peer's agent
    // has no entry here and could not be addressed anyway.
    expect(tinted("@agent-deadbeef and @agent-notanid")).toEqual([]);
  });

  it("does NOT let an agent name steal a MEMBER's tint", () => {
    // ⚠ THE ROSTER IS ASKED FIRST AND WINS. An operator may name an agent after a colleague, and
    // that must not repoint a token the server stamped at the colleague.
    const out = tinted("hi @diana-taylor", "Diana Taylor");
    expect(out).toEqual(["@diana-taylor"]);
  });

  it("gives an agent mention NO viewer highlight — that wash means the server tagged YOU", () => {
    // ⚠ `mentionsMe` is `metadata.mentionedUserIds`, a fact about a MEMBER. An agent mention is
    // not in that set and must not borrow the signal.
    const view = render(
      <MessageMarkdown
        text={`@agent-${AGENT}`}
        index={withAgents(null)}
        mentionsMe
      />
    );
    const span = view.container.querySelector("span.text-link");
    expect(span?.className).not.toMatch(/bg-link/);
  });
});
