import { afterEach, describe, it, expect, vi } from "vitest";
import {
  actionNameForSlug,
  findAction,
  getProviderConfig,
  resolveAuthConfigId,
} from "./providers";
import { ProviderNotConfiguredError } from "./errors";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getProviderConfig", () => {
  it("returns deterministic configs for the original three (read+write) providers", () => {
    const notion = getProviderConfig("notion");
    expect(notion.sourcePlatform).toBe("notion");
    expect(notion.sourceType).toBe("notion_page");
    expect(notion.urlBuilder("abc-def-123")).toBe("https://www.notion.so/abcdef123");
    expect(notion.listActionSlug).toBeDefined();
    expect(notion.fetchActionSlug).toBeDefined();

    const gmail = getProviderConfig("gmail");
    expect(gmail.sourcePlatform).toBe("gmail");
    expect(gmail.urlBuilder("THREAD-id")).toMatch(
      /^https:\/\/mail\.google\.com\/.*THREAD-id$/
    );
    expect(gmail.listActionSlug).toBeDefined();

    const drive = getProviderConfig("google_drive");
    expect(drive.sourcePlatform).toBe("google_drive");
    expect(drive.urlBuilder("FILE_ID")).toBe(
      "https://drive.google.com/file/d/FILE_ID/view"
    );
    expect(drive.fetchActionSlug).toBeDefined();
  });

  it("registers the read-enabled providers with composio toolkit slugs and read paths", () => {
    const expected: Array<{
      provider:
        | "github"
        | "google_calendar"
        | "google_docs"
        | "google_sheets"
        | "slack"
        | "attio";
      sourcePlatform: string;
      composioToolkit: string;
      authConfigEnv: string;
    }> = [
      {
        provider: "github",
        sourcePlatform: "github",
        composioToolkit: "GITHUB",
        authConfigEnv: "INTEGRATIONS_GITHUB_AUTH_CONFIG_ID",
      },
      {
        provider: "google_calendar",
        sourcePlatform: "google_calendar",
        composioToolkit: "GOOGLECALENDAR",
        authConfigEnv: "INTEGRATIONS_GOOGLE_CALENDAR_AUTH_CONFIG_ID",
      },
      {
        provider: "google_docs",
        sourcePlatform: "google_docs",
        composioToolkit: "GOOGLEDOCS",
        authConfigEnv: "INTEGRATIONS_GOOGLE_DOCS_AUTH_CONFIG_ID",
      },
      {
        provider: "google_sheets",
        sourcePlatform: "google_sheets",
        composioToolkit: "GOOGLESHEETS",
        authConfigEnv: "INTEGRATIONS_GOOGLE_SHEETS_AUTH_CONFIG_ID",
      },
      {
        provider: "slack",
        sourcePlatform: "slack",
        composioToolkit: "SLACK",
        authConfigEnv: "INTEGRATIONS_SLACK_AUTH_CONFIG_ID",
      },
      {
        provider: "attio",
        sourcePlatform: "attio",
        composioToolkit: "ATTIO",
        authConfigEnv: "INTEGRATIONS_ATTIO_AUTH_CONFIG_ID",
      },
    ];

    for (const e of expected) {
      const cfg = getProviderConfig(e.provider);
      expect(cfg.sourcePlatform).toBe(e.sourcePlatform);
      expect(cfg.composioToolkit).toBe(e.composioToolkit);
      expect(cfg.composioAuthConfigEnv).toBe(e.authConfigEnv);
      expect(cfg.actions).toEqual([]);
      // Read support added for the demo flow.
      expect(cfg.listActionSlug).toBeDefined();
      expect(cfg.fetchActionSlug).toBeDefined();
    }
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

  it("send_email buildArgs maps single recipient + bcc to GMAIL_SEND_EMAIL", () => {
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

  it("send_email buildArgs splits comma-separated to/cc/bcc and routes extras correctly", () => {
    const send = findAction("gmail", "send_email")!;
    expect(
      send.buildArgs({
        to: "a@b.com, c@d.com , e@f.com",
        subject: "S",
        body: "hi",
        cc: "cc1@x.com,cc2@x.com",
        bcc: "boss@x.com",
      })
    ).toEqual({
      recipient_email: "a@b.com",
      subject: "S",
      body: "hi",
      extra_recipients: ["c@d.com", "e@f.com"],
      cc: ["cc1@x.com", "cc2@x.com"],
      bcc: ["boss@x.com"],
    });
  });

  it("reply_to_thread buildArgs maps to GMAIL_REPLY_TO_THREAD fields with explicit recipient", () => {
    const reply = findAction("gmail", "reply_to_thread");
    expect(reply?.composioSlug).toBe("GMAIL_REPLY_TO_THREAD");
    expect(
      reply!.buildArgs({ thread_id: "t1", to: "a@b.com", body: "ok" })
    ).toEqual({
      thread_id: "t1",
      recipient_email: "a@b.com",
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

  it("hand-curated actions carry a JSON Schema descriptor", () => {
    const send = findAction("gmail", "send_email")!;
    expect(send.paramsJsonSchema).toEqual(
      expect.objectContaining({ type: "object", required: expect.any(Array) })
    );
    const reply = findAction("gmail", "reply_to_thread")!;
    expect(reply.paramsJsonSchema).toEqual(
      expect.objectContaining({ type: "object", required: ["thread_id", "to", "body"] })
    );
  });
});

describe("actionNameForSlug", () => {
  it("strips the toolkit prefix and lowercases", () => {
    expect(actionNameForSlug("GMAIL_CREATE_FILTER", "GMAIL")).toBe("create_filter");
    expect(actionNameForSlug("GMAIL_SEND_EMAIL", "GMAIL")).toBe("send_email");
    expect(actionNameForSlug("GOOGLEDRIVE_LIST_FILES", "GOOGLEDRIVE")).toBe(
      "list_files"
    );
  });

  it("returns lowercased slug when prefix doesn't match", () => {
    expect(actionNameForSlug("GMAIL_SEND_EMAIL", "NOTION")).toBe(
      "gmail_send_email"
    );
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
