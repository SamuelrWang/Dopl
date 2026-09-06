/**
 * 🔒 **THE FAIL-CLOSED BACKFILL, TOLD ONCE** — ruling (c) of task 11 (design
 * #1077, approved #1080). The reach narrowing is the only user-visible
 * regression in the package and it is SILENT: the shelf stops being there, and
 * the fence that hides it answers 404-never-403, so it cannot be the thing that
 * explains itself.
 *
 * ⚠ **WHAT IS PINNED IS THE THREE SILENCES AS MUCH AS THE SENTENCE.** A notice
 * that showed in an armed room, or before the read landed, or a second time
 * after being dismissed, would be the kind of copy people learn to click past —
 * and this one has exactly one chance to be read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/shared/hooks/use-api-query", () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { PersonalReachBackfillNotice } from "./personal-reach-notice";

const mockQuery = vi.mocked(useApiQuery);

const CHANNEL = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTAINER = "e7998a94-d3ab-42cc-8c76-99585bcb920c";
const ME = "u-operator";

/** ⚠ `undefined` is the READ IN FLIGHT, and it is a third state, not a false. */
function reads(armed: boolean | undefined) {
  mockQuery.mockReturnValue({
    data: armed === undefined ? undefined : { armed },
  } as never);
}

function show(userId = ME) {
  return render(
    <PersonalReachBackfillNotice
      channelId={CHANNEL}
      workspaceId={CONTAINER}
      userId={userId}
    />,
  );
}

const notice = () => screen.queryByText(/no longer reach your personal/i);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("the backfill notice", () => {
  it("tells the owner in an UNARMED room, and names the remedy", async () => {
    reads(false);
    show();

    expect(notice()).not.toBeNull();
    // ⚠ It must point at the switch. A notice that only says what was taken
    // away leaves the person with no next action.
    expect(screen.getByText(/switch above/i)).toBeInTheDocument();
  });

  it("says NOTHING once it has been dismissed — once means once", () => {
    reads(false);
    const first = show();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(notice()).toBeNull();

    // ⚠ AND IT STAYS SAID. The flag, not the component's own state, is what
    // survives the next visit to this pane.
    first.unmount();
    show();
    expect(notice()).toBeNull();
  });

  it("says nothing in an ARMED room — they have already met the switch", () => {
    reads(true);
    show();
    expect(notice()).toBeNull();
  });

  it("says nothing while the read is in flight", () => {
    // ⚠ A claim about a switch nobody has looked at yet. The control beside it
    // refuses to render for the same reason.
    reads(undefined);
    show();
    expect(notice()).toBeNull();
  });

  it("🔒 tells a SECOND person on the same machine — the flag is per user", () => {
    reads(false);
    const first = show();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    first.unmount();

    show("u-somebody-else");

    // ⚠ Two people on one device are two people to tell. A shared key would
    // silently swallow the only notice the second one gets.
    expect(notice()).not.toBeNull();
  });

  it("still tells them when the flag store is unreadable", () => {
    // ⚠ THE FAIL DIRECTION IS "TOLD TWICE", NEVER "NEVER TOLD". A locked-down
    // or full `localStorage` must not be able to swallow the one notice.
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    reads(false);
    show();

    expect(notice()).not.toBeNull();
    getItem.mockRestore();
  });
});
