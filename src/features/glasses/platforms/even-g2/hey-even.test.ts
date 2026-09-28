import { describe, expect, it } from "vitest";
import { assistantText, chatCompletion, chatCompletionStream, lastUserText, modelList, redactedHeaders } from "./hey-even";

describe("hey-even shim", () => {
  it("takes the last user message, string or parts", () => {
    expect(lastUserText({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] })).toBe("c");
    expect(lastUserText({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url" }] }] })).toBe("hi");
    expect(lastUserText({})).toBeNull();
  });

  it("answers in chat.completion shape", () => {
    const res = chatCompletion("pong", "chatcmpl-1", 1);
    expect(res).toMatchObject({
      object: "chat.completion",
      model: "dopl-glasses",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
    });
    const sse = chatCompletionStream("pong", "chatcmpl-1", 1);
    expect(sse.trim().split("\n\n")).toHaveLength(3);
    expect(sse.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(modelList(1).data[0].id).toBe("dopl-glasses");
  });

  it("says which agent it went to, by display name when there is one", () => {
    const base = { status: "sent" as const, channel_message_id: "m", addressed_to: "agent-abcdefgh" };
    expect(assistantText({ ...base, addressed_name: "Orchestrator" })).toBe("Sent to Orchestrator.");
    expect(assistantText({ ...base, addressed_name: null })).toBe("Sent to @agent-abcdefgh.");
    expect(assistantText({ status: "sent", channel_message_id: "m", addressed_to: null, channel_name: "Ops" })).toBe("Sent to Ops.");
    expect(assistantText({ status: "sent", channel_message_id: "m", addressed_to: null })).toBe(
      "Sent to your Dopl channel.",
    );
    expect(assistantText({ ...base, status: "replied", reply: "pong", reply_message_id: "r" })).toBe("pong");
  });

  it("redacts credentials in the header log", () => {
    const h = redactedHeaders(new Headers({ authorization: "Bearer x", "user-agent": "EvenApp/1", cookie: "a=b" }));
    expect(h).toEqual({ authorization: "[redacted]", "user-agent": "EvenApp/1", cookie: "[redacted]" });
  });
});
