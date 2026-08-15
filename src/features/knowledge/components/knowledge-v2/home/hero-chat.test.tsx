// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HERO_CHAT_PLACEHOLDER, HERO_CHAT_REPLY, HeroChat } from "./hero-chat";

/**
 * Design-only chat, so this pins the DESIGN's behaviour. Two properties:
 *   1. Honesty: reply is a stated placeholder, mic is a pressed STATE with no
 *      transcription — a mic that writes into the field invents words.
 *   2. ⚠ Collapse animates: the log is still mounted when "clear" is clicked,
 *      because the height transition needs a height to fall from. Invisible in
 *      a screenshot, first thing a "simplify" pass removes.
 *
 * `knowledge-home.test.tsx` owns the ATTACHMENT half.
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
    // Mic is a TOGGLE in the a11y tree, not a tint: `aria-pressed` says so.
    expect(
      screen.getByLabelText("Dictate a message").getAttribute("aria-pressed")
    ).toBe("false");

    expect(screen.getByRole("button", { name: "Summarize a knowledge base" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Draft a new base from my notes" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find where X is documented" })).toBeTruthy();
    expect(screen.getByText("Answers draw on the bases you can see.")).toBeTruthy();

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
    // Chip is a draft, not a submit.
    expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull();
  });
});

describe("HeroChat conversation", () => {
  it("flips on send, showing the typed text and the canned reply", () => {
    render(<HeroChat />);
    type("What is in the sales playbook?");
    fireEvent.click(sendButton());

    expect(screen.getByText("What is in the sales playbook?")).toBeTruthy();
    expect(screen.getByText(HERO_CHAT_REPLY)).toBeTruthy();
    expect(input().value).toBe("");
    // Suggestions are idle-only.
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
    // ⚠ ORDER IS THE POINT: turn stays mounted for the collapse, so the grid
    // track has a height to animate DOWN from. Wiping on click = a jump.
    expect(screen.getByText(HERO_CHAT_REPLY)).toBeTruthy();

    await waitFor(() => expect(screen.queryByText(HERO_CHAT_REPLY)).toBeNull());
    expect(screen.queryByLabelText("Clear conversation")).toBeNull();
    expect(screen.getByRole("button", { name: "Find where X is documented" })).toBeTruthy();
  });
});

describe("HeroChat mic", () => {
  it("toggles a pressed state, and stays honest about it", () => {
    render(<HeroChat />);
    const mic = screen.getByLabelText("Dictate a message");

    fireEvent.click(mic);
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    // NO FAKE TRANSCRIPTION: field untouched, hint says why.
    expect(input().value).toBe("");
    expect(screen.getByText(/not wired up yet/)).toBeTruthy();

    fireEvent.click(mic);
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });
});
