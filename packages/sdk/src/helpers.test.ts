import { describe, expect, it } from "vitest";

import { DoplError } from "./index.js";
import { BASE, DELIVERY, SK, action, client } from "./test-helpers.js";

describe("show and notify are deliver calls (D4)", () => {
  it("show sends intent display with blocks", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: DELIVERY });
    const blocks = [{ id: "h", type: "heading" as const, text: "Hi" }];
    await dopl.show("usr_1", { blocks, target: "glasses" });
    expect(calls[0].url).toBe(`${BASE}/users/usr_1/deliver`);
    expect(calls[0].body).toMatchObject({ intent: "display", content: { blocks }, urgency: "normal", target: "glasses" });
  });

  it("show without text or blocks throws before a request", () => {
    const { dopl, fn } = client(SK, { body: DELIVERY });
    expect(() => dopl.show("u", {})).toThrow(DoplError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("notify sends intent notify with the given urgency and key", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: DELIVERY });
    await dopl.notify("usr_1", { text: "Build done", urgency: "high", idempotencyKey: "n1" });
    expect(calls[0].body).toEqual({ intent: "notify", content: { text: "Build done" }, urgency: "high", idempotency_key: "n1" });
    expect(calls[0].headers["Idempotency-Key"]).toBe("n1");
  });
});

describe("ask delivers, then polls actions.get", () => {
  it("returns the answer once the action is done", async () => {
    const { dopl, calls } = client(
      SK,
      { status: 202, body: DELIVERY },
      { body: action("delivered") },
      { body: action("needs_confirmation") },
      { body: action("done", { result: { choice: "Yes" } }) },
    );
    const res = await dopl.ask("usr_1", { question: "Ship it?", options: ["Yes", "No"], pollIntervalMs: 1 });
    expect(res.status).toBe("answered");
    expect(res.status === "answered" && res.answer).toEqual({ choice: "Yes" });
    expect(calls[0].body).toMatchObject({
      intent: "ask",
      content: { text: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] },
    });
    expect(calls.slice(1).map((c) => `${c.method} ${c.url}`)).toEqual(Array(3).fill(`GET ${BASE}/actions/dlv_1`));
  });

  it("returns status timeout when no answer arrives in time", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: DELIVERY }, { body: action("delivered") });
    const started = Date.now();
    const res = await dopl.ask("usr_1", { question: "q", timeoutMs: 30, pollIntervalMs: 5 });
    expect(res.status).toBe("timeout");
    expect(res.action?.status).toBe("delivered");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls.length).toBeGreaterThan(2);
  });

  it("throws the action's C10 error when it fails", async () => {
    const error = {
      type: "permission_error",
      code: "confirmation_denied",
      message: "Denied.",
      retryable: false,
      doc_url: "https://www.usedopl.com/docs/errors/confirmation-denied",
    };
    const { dopl } = client(SK, { status: 202, body: DELIVERY }, { body: action("failed", { error }) });
    const err = await dopl.ask("u", { question: "q", pollIntervalMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(DoplError);
    expect(err).toMatchObject({ code: "confirmation_denied", docUrl: error.doc_url });
  });
});
