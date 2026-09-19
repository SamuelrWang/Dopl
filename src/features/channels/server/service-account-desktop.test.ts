import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-account");
// ⚠ `profilesFor` reads through THIS module, not `repository-account`. Unmocked
// it reaches for a database that is not here and every case TIMES OUT at 5s —
// which is how this file failed before the mock landed, and why the mock is
// named rather than inferred.
vi.mock("./repository-workspace");

import * as accountRepo from "./repository-account";
import { fetchProfiles } from "./repository-workspace";
import { getAccountStatus } from "./service-account";

/**
 * **`dopl_status` AND THE `@desktop` LANES** (2026-09-18).
 *
 * ⚠ **THE CASE THIS FILE EXISTS FOR IS THE EXCLUSION.** A desktop-run agent
 * shares the operator's ACCOUNT, so a lane keyed on the user id alone hands it
 * every ask aimed at the operator's laptop — work it would then adopt, which is
 * the confusion `@desktop` was created to end. `a desktop-run agent sees
 * neither extra lane` is the regression that would matter most.
 */

const ME = "u-1";
const CHAN = "chan-1";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    seq: 10,
    channel_id: CHAN,
    workspace_id: "ws-1",
    author_user_id: "u-2",
    author_kind: "user",
    kind: "message",
    body: "please look",
    metadata: {},
    client_msg_id: null,
    created_at: "2026-09-18T00:00:00Z",
    ...over,
  };
}

function seed(opts: {
  addressed?: Record<string, unknown>[];
  desktop?: Record<string, unknown>[];
  addressedClipped?: boolean;
  desktopClipped?: boolean;
} = {}) {
  vi.mocked(accountRepo.listAccountChannelRefs).mockResolvedValue({
    rows: [{ id: CHAN, name: "General", slug: "general", workspaceId: "ws-1" }],
    truncated: false,
  } as never);
  vi.mocked(accountRepo.listAccountSessionStates).mockResolvedValue([] as never);
  vi.mocked(accountRepo.presenceAnywhereForUser).mockResolvedValue(false as never);
  vi.mocked(accountRepo.lastSeqByChannel).mockResolvedValue(new Map() as never);
  vi.mocked(accountRepo.listMyLatestSeqByChannel).mockResolvedValue(
    new Map() as never,
  );
  vi.mocked(fetchProfiles).mockResolvedValue([] as never);
  vi.mocked(accountRepo.listAddressedToMe).mockResolvedValue({
    rows: opts.addressed ?? [],
    truncated: opts.addressedClipped ?? false,
  } as never);
  vi.mocked(accountRepo.listDesktopAddressedToMe).mockResolvedValue({
    rows: opts.desktop ?? [],
    truncated: opts.desktopClipped ?? false,
  } as never);
}

const lanesOf = async (outsideSession: boolean) => {
  const status = await getAccountStatus(ME, { outsideSession });
  return status.channels[0].waiting.map((w) => w.lane ?? "person");
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 the lanes are for an OUTSIDE SESSION and nobody else", () => {
  it("a desktop-run agent sees neither extra lane, and pays for no scan", async () => {
    seed({
      addressed: [row({ author_kind: "agent" })],
      desktop: [row({ id: "m-2", seq: 11, metadata: { to_desktop: ME } })],
    });
    // ⚠ `outsideSession: false` is what the route computes for a credential
    // carrying the desktop's runtime stamp.
    expect(await lanesOf(false)).toEqual(["person"]);
    // ⚠ AND THE QUERY IS NOT ISSUED AT ALL — a caller pays nothing for a lane
    // that is not theirs.
    expect(vi.mocked(accountRepo.listDesktopAddressedToMe)).not.toHaveBeenCalled();
  });

  it("an outside session sees the @desktop lane FIRST, then the person lane", async () => {
    seed({
      addressed: [row()],
      desktop: [row({ id: "m-2", seq: 11, metadata: { to_desktop: ME } })],
    });
    // ⚠ ORDER IS THE RENDERING — `status-render.ts` prints array order.
    expect(await lanesOf(true)).toEqual(["desktop", "person"]);
  });
});

describe("the guess is labelled, and never doubled", () => {
  it("an AGENT that addressed the operator is `likely`, not a second row", async () => {
    // ⚠ THE PARTITION, NOT A SECOND SCAN. Before `@desktop` existed, an agent
    // addressing the OPERATOR was the only way to reach this lane, so for an
    // outside session that row is a guess worth showing — but it is the SAME
    // row, relabelled, never listed twice.
    seed({ addressed: [row({ author_kind: "agent" })] });
    expect(await lanesOf(true)).toEqual(["likely"]);
  });

  it("a HUMAN asking is a fact and stays `person`", async () => {
    seed({ addressed: [row({ author_kind: "user" })] });
    expect(await lanesOf(true)).toEqual(["person"]);
  });

  it("the same agent-authored row is a plain `person` ask for everyone else", async () => {
    // ⚠ NO EXISTING CALLER'S BYTES MOVE. The partition is scoped to the one
    // caller class it is a guess FOR.
    seed({ addressed: [row({ author_kind: "agent" })] });
    expect(await lanesOf(false)).toEqual(["person"]);
  });
});

describe("§9 — a clipped scan is reported, from EITHER lane", () => {
  it("reports the clip when the @desktop scan hit its ceiling", async () => {
    // ⚠ A reader told the page is whole while one of its two scans clipped is
    // exactly the false negative §9 forbids.
    seed({ addressed: [], desktop: [row({ metadata: { to_desktop: ME } })], desktopClipped: true });
    const status = await getAccountStatus(ME, { outsideSession: true });
    expect(status.truncated.waiting).toBe(true);
  });

  it("still reports the person lane's own clip", async () => {
    seed({ addressed: [row()], addressedClipped: true });
    const status = await getAccountStatus(ME, { outsideSession: true });
    expect(status.truncated.waiting).toBe(true);
  });

  it("says nothing was clipped when neither lane was", async () => {
    seed({ addressed: [row()], desktop: [] });
    const status = await getAccountStatus(ME, { outsideSession: true });
    expect(status.truncated.waiting).toBe(false);
  });
});

describe("the stale-payload fallback", () => {
  it("an item with NO lane reads as `person`", async () => {
    // ⚠ Every item an older server produced, and every payload cached before
    // the field existed. The optional field is what lets a stale payload render
    // without being re-fetched.
    seed({ addressed: [row()] });
    const status = await getAccountStatus(ME, { outsideSession: false });
    expect(status.channels[0].waiting[0].lane).toBeUndefined();
  });
});
