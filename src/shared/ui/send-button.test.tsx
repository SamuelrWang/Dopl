import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SendButton, sendButtonLabel } from "./send-button";

const noop = () => {};

/** The round ink send: the kit's `.send-round` at 30px. */
const FACE = ["send-round", "h-[30px]", "w-[30px]"];

describe("SendButton (the one shared send affordance)", () => {
  it("wears the round ink kit face at 30px", () => {
    const markup = renderToStaticMarkup(<SendButton onClick={noop} />);
    for (const cls of FACE) expect(markup).toContain(cls);
  });

  it("owns no shadow/gradient/hex recipe of its own — the kit class carries it", () => {
    const markup = renderToStaticMarkup(<SendButton onClick={noop} />);
    expect(markup).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(markup).not.toContain("shadow-[");
    expect(markup).not.toContain("linear-gradient");
    expect(markup).not.toContain("auth-btn-3d");
  });

  it("shows the up-arrow glyph at rest and the pause bars while running", () => {
    const send = renderToStaticMarkup(<SendButton onClick={noop} />);
    expect(send).toContain("M8 13V3.6M8 3.2 3.9 7.3M8 3.2l4.1 4.1");
    expect(send).not.toContain("<rect");

    const pause = renderToStaticMarkup(<SendButton mode="pause" onClick={noop} />);
    expect((pause.match(/<rect/g) ?? []).length).toBe(2);
    expect(pause).not.toContain("M8 13V3.6");
  });

  it("names itself per mode, and the caller can override the name", () => {
    expect(sendButtonLabel("send")).toBe("Send");
    expect(sendButtonLabel("pause")).toBe("Pause the agent");
    expect(renderToStaticMarkup(<SendButton onClick={noop} />)).toContain(
      'aria-label="Send"'
    );
    expect(
      renderToStaticMarkup(<SendButton mode="pause" onClick={noop} />)
    ).toContain('aria-label="Pause the agent"');
    expect(
      renderToStaticMarkup(<SendButton onClick={noop} label="Send message" />)
    ).toContain('aria-label="Send message"');
  });

  it("disables through the native attribute, so the kit's :disabled state applies", () => {
    const markup = renderToStaticMarkup(<SendButton onClick={noop} disabled />);
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("text-text-disabled");
  });

  it("is a type=button, so it never submits a surrounding form", () => {
    expect(renderToStaticMarkup(<SendButton onClick={noop} />)).toContain(
      'type="button"'
    );
  });
});
