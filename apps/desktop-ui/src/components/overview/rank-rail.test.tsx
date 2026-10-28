import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_TOOL_USAGE,
} from "@/features/home/overview-types";
import { EMPTY_WORKSPACE_CHANNEL_USAGE } from "@/features/workspaces/types";
import {
  ChannelCreditRail,
  ChannelMessageRail,
  PeopleRail,
  ToolRail,
  type PersonRailRow,
} from "./rank-rail";

/**
 * ONE RAIL RECIPE, ONE FALLBACK PER NAME. Three `EMPTY_*` names once resolved to a DIFFERENT
 * frozen array depending on the import specifier. Source pins, because a divergence is a second
 * declaration — it renders fine and no render test can see it.
 */

const file = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Source with comments stripped — these files EXPLAIN the asymmetry they are
 *  scanned for, so a raw scan would fail on the docblock recording it. */
const code = (rel: string) =>
  file(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HOME_LEDGER = file(
  "../../../../../src/features/home/components/overview/overview-ledger.tsx"
);
const WORKSPACE_RAILS = file("../../pages/overview/usage-rails.tsx");
const HOME_TYPES = file("../../../../../src/features/home/overview-types.ts");
const WORKSPACE_TYPES = file("../../../../../src/features/workspaces/types.ts");

const RAILS = [
  "ChannelCreditRail",
  "ChannelMessageRail",
  "PeopleRail",
  "ToolRail",
  "RailsGhost",
];

afterEach(cleanup);

describe("the workspace Overview's rails", () => {
  it("is ONE declaration — the page declares no rail of its own", () => {
    for (const rail of RAILS) {
      expect(new RegExp(`function ${rail}\\b`).test(WORKSPACE_RAILS), rail).toBe(false);
      expect(WORKSPACE_RAILS).toContain(rail);
    }
    expect(WORKSPACE_RAILS).toContain('from "#/components/overview/rank-rail"');
  });

  it("keeps the channel ID KEY at the caller, never as a flag on the rail", () => {
    const shared = code("./rank-rail.tsx");
    expect(shared).not.toContain("workspaceId");
    expect(shared).not.toContain("channelId");
    expect(WORKSPACE_RAILS).toContain("id: row.channelId");
  });

  it("takes a nullable `role` — a departed member's spend survives them", () => {
    // A departed member's spend survives them, so /home has no role to send.
    const rows: PersonRailRow[] = [
      { userId: "u-1", name: "Ada", role: null, credits: 30 },
      { userId: "u-2", name: "", role: "guest", credits: 10 },
    ];
    render(<PeopleRail rows={rows} />);
    expect(screen.getByText("Guest")).toBeDefined();
    expect(screen.getByText("1 guest · 10")).toBeDefined();
    expect(screen.getByText("Unknown member")).toBeDefined();
  });

  it("labels a nameless channel and ranks messages by their own figure", () => {
    render(
      <>
        <ChannelCreditRail
          rows={[
            { id: "a", name: "", value: 1 },
            { id: "b", name: "Build", value: 9 },
          ]}
        />
        <ChannelMessageRail
          rows={[
            { id: "a", name: "Quiet", value: 2 },
            { id: "b", name: "Loud", value: 40 },
          ]}
        />
      </>
    );
    expect(screen.getByText("Untitled channel")).toBeDefined();
    const messages = screen.getByRole("heading", { name: "Messages by channel" })
      .parentElement?.parentElement;
    const names = [...(messages?.querySelectorAll("li > span:first-child") ?? [])];
    expect(names.map((n) => n.textContent)).toEqual(["Loud", "Quiet"]);
  });

  it("draws an empty rail as a line, never a bar of NaN", () => {
    const { container } = render(<ToolRail rows={EMPTY_TOOL_USAGE} />);
    expect(screen.getByText("Nothing yet.")).toBeDefined();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("the stale-cache fallbacks (INVARIANTS §8)", () => {
  it("declares each EMPTY name ONCE across the two payload modules", () => {
    for (const name of [
      "EMPTY_CHANNEL_USAGE",
      "EMPTY_PERSON_USAGE",
      "EMPTY_TOOL_USAGE",
    ]) {
      const declared = [HOME_TYPES, WORKSPACE_TYPES].filter((source) =>
        new RegExp(`export const ${name}\\b`).test(source)
      );
      expect(declared, `${name} is declared twice`).toHaveLength(1);
    }
  });

  it("does NOT merge the channel fallback — the two row shapes differ", () => {
    // `workspaceId` vs `channelId`: one name for both would be a bundler trap,
    // so the workspace one carries its container in its NAME.
    expect(EMPTY_WORKSPACE_CHANNEL_USAGE).not.toBe(EMPTY_CHANNEL_USAGE);
    expect(
      /export const EMPTY_WORKSPACE_CHANNEL_USAGE\b/.test(WORKSPACE_TYPES)
    ).toBe(true);
    expect(/export const EMPTY_CHANNEL_USAGE\b/.test(WORKSPACE_TYPES)).toBe(
      false
    );
  });

  it("keeps a `?? EMPTY_` on every array read on both faces", () => {
    for (const [face, source, reads] of [
      ["/home", HOME_LEDGER, ["channels", "people", "tools"]],
      ["workspace", WORKSPACE_RAILS, ["channels", "people", "tools"]],
    ] as const) {
      for (const key of reads) {
        const guarded = new RegExp(`\\.${key} \\?\\? EMPTY_`).test(source);
        expect({ face, key, guarded }).toEqual({ face, key, guarded: true });
      }
    }
    expect(Object.isFrozen(EMPTY_PERSON_USAGE)).toBe(true);
  });
});
