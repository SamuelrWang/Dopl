/**
 * `callRef` (DMP-013 B3): the renderer against the manifest. The legacy surface it must not move is
 * `legacy-surface.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { callRef, calledAs, toolName, withToolSet } from "./call-ref.js";

describe("callRef", () => {
  it("spells a legacy call from the key, and the granular tool that runs it", () => {
    const args = { channel: '"eng"', wait_ms: true } as const;
    expect(callRef("channel.read", args)).toBe('dopl_channel(op="read", channel="eng", wait_ms)');
    expect(withToolSet("granular", () => callRef("channel.read", args))).toBe('dopl_read_channel(channel="eng", wait_ms)');
  });

  it("names the job on a multi-job tool, and leaves out a preset the tool fixes", () => {
    expect(callRef("channel.rooms.list")).toBe('dopl_channel(op="rooms", action="list")');
    withToolSet("granular", () => {
      expect(callRef("channel.rooms.list")).toBe("dopl_list_channels()");
      expect(callRef("channel.rooms.threads", { channel: "<ref>" })).toBe('dopl_get_channel(action="threads", channel=<ref>)');
      expect(callRef("channel.send", { kind: '"decision"', body: "…" })).toBe("dopl_request_decision(body=…)");
      expect(callRef("channel.send", { kind: '"milestone"' })).toBe('dopl_send_message(kind="milestone")');
      expect(callRef("kb.search")).toBe('dopl_search(within="knowledge")');
    });
  });

  it("has a tool-relative legacy form and the caller's quote", () => {
    expect(callRef("kb.list_dir", {}, { form: "op" })).toBe('op="list_dir"');
    expect(callRef("channel.rooms.help", {}, { form: "op" })).toBe('op="rooms" action="help"');
    expect(callRef("members.whoami", {}, { quote: "'" })).toBe("dopl_members(op='whoami')");
    expect(withToolSet("granular", () => callRef("kb.list_dir", {}, { form: "op" }))).toBe('dopl_browse_knowledge(action="list_dir")');
  });

  it("names a tool bare, and names the call back as its caller spelled it", () => {
    expect([toolName("status"), withToolSet("granular", () => toolName("status"))]).toEqual(["dopl_status", "dopl_get_status"]);
    expect(calledAs("export")).toBe('op="export"');
    expect(withToolSet("granular", () => calledAs("export"))).toBe('op="export"');
    expect(withToolSet("granular", () => calledAs("export"), "dopl_save_chat")).toBe("dopl_save_chat");
  });

  it("refuses a key the manifest does not bind", () => {
    expect(() => callRef("channel.nope")).toThrow(/not a manifest key/);
  });
});
