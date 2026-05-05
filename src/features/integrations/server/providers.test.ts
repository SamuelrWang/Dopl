import { afterEach, describe, it, expect, vi } from "vitest";
import { findAction, getProviderConfig, resolveAuthConfigId } from "./providers";
import { ProviderNotConfiguredError } from "./errors";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getProviderConfig", () => {
  it("returns deterministic configs per supported provider", () => {
    const notion = getProviderConfig("notion");
    expect(notion.sourcePlatform).toBe("notion");
    expect(notion.sourceType).toBe("notion_page");
    expect(notion.urlBuilder("abc-def-123")).toBe("https://www.notion.so/abcdef123");

    const gmail = getProviderConfig("gmail");
    expect(gmail.sourcePlatform).toBe("gmail");
    expect(gmail.urlBuilder("THREAD-id")).toMatch(
      /^https:\/\/mail\.google\.com\/.*THREAD-id$/
    );

    const drive = getProviderConfig("google_drive");
    expect(drive.sourcePlatform).toBe("google_drive");
    expect(drive.urlBuilder("FILE_ID")).toBe(
      "https://drive.google.com/file/d/FILE_ID/view"
    );
  });
});

describe("Gmail actions registry", () => {
  it("registers send_email and reply_to_thread", () => {
    const gmail = getProviderConfig("gmail");
    expect(gmail.actions.map((a) => a.name)).toEqual([
      "send_email",
      "reply_to_thread",
    ]);
  });

  it("send_email buildArgs maps to GMAIL_SEND_EMAIL fields and wraps cc/bcc", () => {
    const send = findAction("gmail", "send_email");
    expect(send?.composioSlug).toBe("GMAIL_SEND_EMAIL");
    const args = send!.buildArgs({
      to: "a@b.com",
      subject: "S",
      body: "hi",
      bcc: "boss@x.com",
    });
    expect(args).toEqual({
      recipient_email: "a@b.com",
      subject: "S",
      body: "hi",
      bcc: ["boss@x.com"],
    });
  });

  it("reply_to_thread buildArgs maps to GMAIL_REPLY_TO_THREAD fields", () => {
    const reply = findAction("gmail", "reply_to_thread");
    expect(reply?.composioSlug).toBe("GMAIL_REPLY_TO_THREAD");
    expect(reply!.buildArgs({ thread_id: "t1", body: "ok" })).toEqual({
      thread_id: "t1",
      message_body: "ok",
    });
  });

  it("parseResponse extracts id + thread_id from a Composio top-level envelope", () => {
    const send = findAction("gmail", "send_email")!;
    expect(send.parseResponse({ id: "msg_x", threadId: "thr_x" })).toEqual({
      ok: true,
      data: { id: "msg_x", thread_id: "thr_x" },
    });
  });

  it("parseResponse extracts id + thread_id from a nested response_data envelope", () => {
    const reply = findAction("gmail", "reply_to_thread")!;
    expect(
      reply.parseResponse({ response_data: { id: "msg_y", threadId: "thr_y" } })
    ).toEqual({
      ok: true,
      data: { id: "msg_y", thread_id: "thr_y" },
    });
  });

  it("findAction returns null for unknown actions", () => {
    expect(findAction("gmail", "nope")).toBeNull();
    expect(findAction("notion", "send_email")).toBeNull();
  });
});

describe("resolveAuthConfigId", () => {
  it("returns the configured id when env is set", () => {
    vi.stubEnv("INTEGRATIONS_NOTION_AUTH_CONFIG_ID", "auth_xyz");
    expect(resolveAuthConfigId("notion")).toBe("auth_xyz");
  });

  it("throws ProviderNotConfiguredError when env is missing", () => {
    vi.stubEnv("INTEGRATIONS_GMAIL_AUTH_CONFIG_ID", "");
    expect(() => resolveAuthConfigId("gmail")).toThrow(ProviderNotConfiguredError);
  });
});
