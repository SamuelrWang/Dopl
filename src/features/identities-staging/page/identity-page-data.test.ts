// The page's arrangement logic (item 3c), which is where the behaviour actually lives: `curl`
// proves the surfaces render and says nothing about what the scope control DOES.
import { describe, expect, it } from "vitest";
import { SEED_IDENTITIES } from "../data";
import {
  activeEverywhere,
  arrangeIdentities,
  inScope,
  pageFeed,
  pooledRuns,
  reachLabel,
  runtimeReadiness,
} from "./identity-page-data";

const ALL = { query: "", runtime: "all", sort: "name" as const, scope: "all" };
const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id);

describe("the channel scope", () => {
  it("defaults to every channel, and narrowing drops the shared rows that do not reach it", () => {
    expect(arrangeIdentities(SEED_IDENTITIES, ALL)).toHaveLength(SEED_IDENTITIES.length);
    const scoped = arrangeIdentities(SEED_IDENTITIES, { ...ALL, scope: "#design-review" });
    // Design Critic reaches #design-review; the other four shared rows do not.
    expect(ids(scoped)).toContain("id-critic");
    expect(ids(scoped)).not.toContain("id-release");
  });

  it("NEVER hides a personal row: it is yours in every channel", () => {
    const scoped = arrangeIdentities(SEED_IDENTITIES, { ...ALL, scope: "#flaky-tests" });
    for (const id of ["id-coder", "id-writer", "id-chief"]) expect(ids(scoped)).toContain(id);
    expect(inScope(SEED_IDENTITIES.find((i) => i.id === "id-writer")!, "#design-review")).toBe(true);
  });

  it("says where a shared row reaches, and the channel itself once narrowed", () => {
    const release = SEED_IDENTITIES.find((i) => i.id === "id-release")!;
    expect(reachLabel(release, "all")).toBe("Shared in #releases and #tech-debt");
    expect(reachLabel(release, "#releases")).toBe("Shared in #releases");
    // A private row has no reach and so no scope line.
    expect(reachLabel(SEED_IDENTITIES.find((i) => i.id === "id-coder")!, "all")).toBeNull();
  });
});

describe("search, filter and sort", () => {
  it("searches the name, the description and the runtime, never the instructions", () => {
    expect(ids(arrangeIdentities(SEED_IDENTITIES, { ...ALL, query: "postmortem" }))).toEqual([
      "id-postmortem",
    ]);
    // "INVARIANTS" appears only in Coder's instructions, which search must not read.
    expect(arrangeIdentities(SEED_IDENTITIES, { ...ALL, query: "INVARIANTS" })).toHaveLength(0);
  });

  it("filters by runtime and sorts by name, recency and what is running", () => {
    const codex = arrangeIdentities(SEED_IDENTITIES, { ...ALL, runtime: "codex" });
    expect(ids(codex).sort()).toEqual(["id-flake", "id-researcher", "id-sql"]);

    const byName = arrangeIdentities(SEED_IDENTITIES, ALL);
    expect(byName[0].name.localeCompare(byName[1].name)).toBeLessThanOrEqual(0);

    const running = arrangeIdentities(SEED_IDENTITIES, { ...ALL, sort: "running" });
    // SQL Reviewer has two agents on it, more than any other row.
    expect(running[0].id).toBe("id-sql");

    const recent = arrangeIdentities(SEED_IDENTITIES, { ...ALL, sort: "recent" });
    expect(recent[0].id).toBe("id-coder"); // its newest log row is 4 minutes old
  });
});

describe("the page's own aggregates", () => {
  it("interleaves every identity's log into one feed, newest first", () => {
    const feed = pageFeed(SEED_IDENTITIES, 5);
    expect(feed).toHaveLength(5);
    for (let i = 1; i < feed.length; i += 1) {
      expect(feed[i - 1].at).toBeLessThanOrEqual(feed[i].at);
    }
    // It spans more than one identity, which is the whole point of a page-level feed.
    expect(new Set(feed.map((row) => row.identity.id)).size).toBeGreaterThan(1);
  });

  // ── Item 7, fix 7: the state is two-valued on the page, and ENDED never reaches it ──

  it("pools ended runs alongside live ones, so the gate below has something to drop", () => {
    // Guards the trap this replaced: ended rows keyed to an identity that does not exist never
    // enter the pool, and the gate then passes while enforcing nothing.
    const pooled = SEED_IDENTITIES.flatMap((identity) => pooledRuns(identity));
    expect(pooled.filter((run) => run.state === "ended").length).toBeGreaterThan(0);
    expect(pooled.filter((run) => run.state !== "ended").length).toBeGreaterThan(0);
  });

  it("NEVER surfaces an ended agent", () => {
    const active = activeEverywhere(SEED_IDENTITIES);
    expect(active.length).toBeGreaterThan(0);
    for (const run of active) expect(run.state).not.toBe("ended");
    // Named rather than counted: the exact runs the pool holds as ended are absent by thread.
    const threads = active.map((run) => run.thread);
    expect(threads).not.toContain("Cut 1.7.23");
    expect(threads).not.toContain("Index audit");
    // And the live one on the same identity survived, so the gate is a filter, not a blanket.
    expect(threads).toContain("Cut 1.7.24");
  });

  it("gives every surviving run a word, and puts the working ones first", () => {
    const active = activeEverywhere(SEED_IDENTITIES);
    expect(active.some((run) => run.state === "working")).toBe(true);
    expect(active.some((run) => run.state === "idle")).toBe(true);
    const firstIdle = active.findIndex((run) => run.state === "idle");
    expect(active.slice(0, firstIdle).every((run) => run.state === "working")).toBe(true);
  });

  it("draws all three runtime worlds, and keeps one runtime launchable in each", () => {
    expect(runtimeReadiness("ready").every((r) => r.state === "ready")).toBe(true);
    for (const scenario of ["reauth", "signin"] as const) {
      const rows = runtimeReadiness(scenario);
      expect(rows.some((r) => r.state === "ready")).toBe(true);
      expect(rows.some((r) => r.state === scenario)).toBe(true);
    }
  });
});
