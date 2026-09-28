import { describe, expect, it } from "vitest";
import { buildClaudeCliHttp, buildCodexCliHttp, connectRecipes } from "./snippets";

const URL_ = "https://www.usedopl.com/api/mcp";

describe("connect snippets", () => {
  it("builds the CLI one-liners around the endpoint", () => {
    expect(buildClaudeCliHttp(URL_)).toBe(`claude mcp add --transport http dopl ${URL_}`);
    expect(buildCodexCliHttp(URL_)).toBe(`codex mcp add dopl --url ${URL_}`);
  });

  it("names one recipe per client, each carrying the endpoint", () => {
    const recipes = connectRecipes(URL_);
    expect(recipes.map((r) => r.client)).toEqual(["Claude Code", "Codex", "Claude", "Cursor and others"]);
    for (const r of recipes) expect(r.text).toContain(URL_);
  });
});
