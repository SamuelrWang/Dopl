// @vitest-environment jsdom
/**
 * THE RENAME THAT WAS REFUSED, and what the input is left showing.
 *
 * The pane commits name/description on blur and deliberately has NO prop-sync
 * effect: `members-view` renders it with `key={team.id}`, so a team switch
 * remounts and the `useState` initialisers are the sync. That is the right
 * shape for the success path — and it means a REFUSED write has nothing to
 * correct the field. The mutation layer restores the cached team verbatim, so
 * the crumb and the list row go back to the old name while the input keeps the
 * text the server rejected, presented as if it had been saved.
 *
 * The writes are mocked rather than driven through the transport: the property
 * here is the pane's own local state after a rejected `mutateAsync`, and the
 * rollback underneath it is already pinned by `write-configs.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { TeamView } from "@/features/teams/types";

const writes = vi.hoisted(() => ({
  /** Non-null makes every `update` reject with this message. */
  rejectWith: null as string | null,
  drafts: [] as Array<{ patch: { name?: string; description?: string | null } }>,
}));

const inert = { mutateAsync: async () => ({}), mutate: () => {}, pending: false };

vi.mock("../hooks/use-team-writes", () => ({
  useTeamWrites: () => ({
    update: {
      ...inert,
      mutateAsync: (draft: { patch: { name?: string } }) => {
        writes.drafts.push(draft);
        return writes.rejectWith
          ? Promise.reject(new Error(writes.rejectWith))
          : Promise.resolve({});
      },
    },
    remove: inert,
    addMembers: inert,
    removeMembers: inert,
    pending: false,
  }),
}));

vi.mock("../hooks/use-access-writes", () => ({
  useAccessWrites: () => ({ setGrant: inert, setScope: inert, pending: false }),
}));

const { TeamDetail } = await import("./team-detail");

const TEAM: TeamView = {
  id: "t-1",
  workspaceId: "w-1",
  name: "Growth",
  description: "Demand gen",
  color: null,
  icon: null,
  createdBy: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  memberCount: 0,
  memberIds: [],
  grants: [],
};

function mount() {
  const view = render(
    <TeamDetail
      workspaceSlug="acme"
      team={TEAM}
      members={[]}
      resources={[]}
      canManage
      onDeleted={() => {}}
    />
  );
  return {
    name: view.getByLabelText("Team name") as HTMLInputElement,
    description: view.getByLabelText("Team description") as HTMLInputElement,
    view,
  };
}

/** Type into a field and commit it the way the pane commits: on blur. */
async function commit(field: HTMLInputElement, value: string) {
  fireEvent.change(field, { target: { value } });
  await act(async () => {
    fireEvent.blur(field);
  });
}

beforeEach(() => {
  writes.rejectWith = null;
  writes.drafts.length = 0;
});
afterEach(cleanup);

describe("team rename", () => {
  it("puts the field back to the saved name when the PATCH is refused", async () => {
    writes.rejectWith = "Only admins can rename a team";
    const { name, view } = mount();

    await commit(name, "Growth EMEA");

    expect(writes.drafts).toEqual([{ teamId: "t-1", patch: { name: "Growth EMEA" } }]);
    expect(name.value).toBe("Growth");
    expect(view.getByText("Only admins can rename a team")).toBeTruthy();
  });

  it("keeps the committed name when the PATCH succeeds", async () => {
    const { name } = mount();

    await commit(name, "  Growth EMEA  ");

    // Normalised to what was actually sent, and it stays.
    expect(name.value).toBe("Growth EMEA");
  });

  it("puts the description back too", async () => {
    writes.rejectWith = "Nope";
    const { description } = mount();

    await commit(description, "Pipeline and demand gen");

    expect(description.value).toBe("Demand gen");
  });
});
