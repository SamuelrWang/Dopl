import { describe, expect, it } from "vitest";
import {
  isSlashDraft,
  matchingSlashCommands,
  NEW_AGENT_COMMAND,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "./composer-commands";

describe("parseSlashCommand", () => {
  it("parses the bare command with no name", () => {
    expect(parseSlashCommand("/new-agent")).toEqual({
      name: "new-agent",
      arg: null,
    });
  });

  it("parses an explicit handle", () => {
    expect(parseSlashCommand("/new-agent scout")).toEqual({
      name: "new-agent",
      arg: "scout",
    });
  });

  it("tolerates surrounding whitespace and extra spacing", () => {
    expect(parseSlashCommand("  /new-agent   scout  ")).toEqual({
      name: "new-agent",
      arg: "scout",
    });
  });

  it("is case-insensitive on the command word", () => {
    expect(parseSlashCommand("/NEW-AGENT")?.name).toBe(NEW_AGENT_COMMAND);
  });

  it("refuses a slash that is not the whole draft (prose stays prose)", () => {
    expect(parseSlashCommand("ask them for /new-agent help")).toBeNull();
  });

  it("refuses an unknown command, so it posts as text instead of vanishing", () => {
    expect(parseSlashCommand("/deploy now")).toBeNull();
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("refuses ordinary messages", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });
});

describe("the hint row's command list", () => {
  it("shows every command on a bare slash", () => {
    expect(matchingSlashCommands("/")).toEqual(SLASH_COMMANDS);
  });

  it("narrows as the name is typed", () => {
    expect(matchingSlashCommands("/new").map((c) => c.name)).toEqual([
      NEW_AGENT_COMMAND,
    ]);
  });

  it("goes silent on a command the composer does not implement", () => {
    expect(matchingSlashCommands("/deploy")).toEqual([]);
  });

  it("never shows for a draft that is not a command", () => {
    expect(isSlashDraft("hello /new-agent")).toBe(false);
    expect(matchingSlashCommands("hello")).toEqual([]);
  });

  it("shows on the first keystroke, before the name is complete", () => {
    expect(isSlashDraft("/")).toBe(true);
  });

  it("advertises the one command with its usage", () => {
    expect(SLASH_COMMANDS).toHaveLength(1);
    expect(SLASH_COMMANDS[0]).toMatchObject({
      name: "new-agent",
      usage: "/new-agent [name]",
    });
  });
});
