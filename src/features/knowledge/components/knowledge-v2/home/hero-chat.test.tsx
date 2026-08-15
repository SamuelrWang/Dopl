// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HERO_CHAT_PLACEHOLDER, HERO_CHAT_REPLY, HeroChat } from "./hero-chat";

/**
 * THE HERO CHAT — design-only, so what is pinned here is the DESIGN's
 * behaviour, not a product contract. Two things this suite exists to keep:
 *
 *   1. **It stays honest.** The reply is a stated placeholder, and the mic is a
 *      pressed STATE with no transcription behind it — a later edit that makes
 *      the mic write into the field would be inventing words the user did not
 *      say, and the assertion below is what catches it.
 *   2. **The collapse animates.** The log is deliberately still mounted at the
 *      moment "clear" is clicked, because the height transition needs a height
 *      to fall from. That ordering is invisible in a screenshot and is exactly
 *      what a "simplify" pass removes, so it is asserted directly.
 *
 * `knowledge-home.test.tsx` owns the other half: that this is ATTACHED to the
 * hero and absent when the hero is.
 */

afterEach(cleanup);

function input() {
  return screen.getByPlaceholderText(HERO_CHAT_PLACEHOLDER) as HTMLTextAreaElement;
}

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

function sendButton() {
  return screen.getByLabelText("Send to the assistant") as HTMLButtonElement;
}

describe("HeroChat idle", () => {
  it("is an input, a mic, a send button and three canned prompts", () => {
    render(<HeroChat />);

    expect(input()).toBeTruthy();
    expect(sendButton()).toBeTruthy();
    // The mic is a TOGGLE in the accessibility tree, not a tint: `aria-pressed`
    // is the only thing that says so, and it starts off.
    expect(
      screen.getByLabelText("Dictate a message").getAttribute("aria-pressed")
    ).toBe("false");

    expect(screen.getByRole("button", { name: "Summarize a knowledge base" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Draft a new base from my notes" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find where X is documented" })).toBeTruthy();
    expect(screen.getByText("Answers draw on the bases you can see.")).toBeTruthy();

    // Idle = no conversation, and specifically no canned reply sitting there.
    expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull();
    expect(screen.queryByLabelText("Clear conversation")).toBeNull();
  });

  it("refuses to send an empty (or whitespace-only) draft", () => {
    render(<HeroChat />);
    expect(sendButton().disabled).toBe(true);

    type("   ");
    expect(sendButton().disabled).toBe(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull();
  });

  it("fills the input from a suggestion chip WITHOUT sending it", () => {
    render(<HeroChat />);
    fireEvent.click(screen.getByRole("button", { name: "Summarize a knowledge base" }));

    expect(input().value).toBe("Summarize a knowledge base");
    // A chip is a draft, not a submit — one click must not start a turn.
    expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull();
  });
});

describe("HeroChat conversation", () => {
  it("flips on send, showing the typed text and the canned reply", () => {
    render(<HeroChat />);
    type("What is in the sales playbook?");
    fireEvent.click(sendButton());

    // The user's OWN words, verbatim — not a summary, not the placeholder.
    expect(screen.getByText("What is in the sales playbook?")).toBeTruthy();
    expect(screen.getByText(HERO_CHAT_REPLY)).toBeTruthy();
    // The draft is consumed and the input stays put, ready for the next turn.
    expect(input().value).toBe("");
    // Suggestions are an idle affordance; they go once there is a conversation.
    expect(screen.queryByRole("button", { name: "Find where X is documented" })).toBeNull();
  });

  it("sends on Enter, and APPENDS a second turn rather than replacing the first", () => {
    render(<HeroChat />);
    type("first question");
    fireEvent.keyDown(input(), { key: "Enter" });
    type("second question");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(screen.getByText("first question")).toBeTruthy();
    expect(screen.getByText("second question")).toBeTruthy();
    expect(screen.getAllByText(HERO_CHAT_REPLY)).toHaveLength(2);
  });

  it("treats Shift+Enter as a newline, not a send", () => {
    render(<HeroChat />);
    type("half a thought");
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull();
    expect(input().value).toBe("half a thought");
  });

  it("clears back to idle — and the log OUTLIVES the collapse animation", async () => {
    render(<HeroChat />);
    type("something");
    fireEvent.keyDown(input(), { key: "Enter" });

    fireEvent.click(screen.getByLabelText("Clear conversation"));
    // THE ORDER IS THE POINT: the turn is still mounted for the length of the
    // collapse, so the grid track has a height to animate DOWN from. Wiping it
    // on the click would turn the close into a jump.
    expect(screen.getByText(HERO_CHAT_REPLY)).toBeTruthy();

    await waitFor(() => expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull());
    expect(screen.queryByLabelText("Clear conversation")).toBeNull();
    // Idle means idle: the suggestions come back.
    expect(screen.getByRole("button", { name: "Find where X is documented" })).toBeTruthy();
  });
});

describe("HeroChat mic", () => {
  it("toggles a pressed state, and stays honest about it", () => {
    render(<HeroChat />);
    const mic = screen.getByLabelText("Dictate a message");

    fireEvent.click(mic);
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    // NO FAKE TRANSCRIPTION. The field is untouched and the hint says why —
    // a pressed mic that quietly typed something would be the design lying.
    expect(input().value).toBe("");
    expect(screen.getByText(/not wired up yet/)).toBeTruthy();

    fireEvent.click(mic);
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });
});
