import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok, renderWithProviders } from "#/test-utils/bridge";
import { HomeChannelCreateSchema } from "@/features/home/schema";
import { isAccountChannels } from "./home-test-harness";
import { NewChannelDialog } from "./new-channel-dialog";

/**
 * THE NEW-CHANNEL POPUP, ON THE KIT (Samuel, 2026-09-15: *"Look at the new
 * channel pop up. we need to overhaul to match it to the other pop ups UI, like
 * the new agent pop up. So it should have name, also, I want to add description
 * as a new field … match the buttons dimensions to be right according to the pop
 * ups we have elsewhere"*).
 *
 * ⚠ **THE PAYLOAD IS WHAT THIS SUITE IS FOR.** "Description" is the word on the
 * screen and `topic` is the field on the wire — the EXISTING column, not a new
 * one.
 *
 * ⚠ AN EMPTY DESCRIPTION SENDS NO KEY AT ALL, which is also what keeps the
 * page-level flow in `index.test.tsx` asserting `{ name }` exactly: `""` and
 * absent are one fact, and two spellings of it on the wire is how a diff starts
 * being about the serializer.
 *
 * ⚠ MOUNTED DIRECTLY. The page-level entry (the button, the tab it lands on) is
 * `index.test.tsx`'s; what is local to this file is the FORM.
 */

const apiRequest = vi.hoisted(() => vi.fn());

const WORKSPACE_ID = "ws-new";

function serve(): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      // 🔒 **`POST /api/channels?scope=account` SINCE R-26 (b)** — the scope is
      // what picks the handler, so a create that omitted it would reach the
      // CONTAINER create instead.
      if (isAccountChannels(path) && opts.method === "POST") {
        return Promise.resolve(
          ok({ channel: { workspaceId: WORKSPACE_ID } })
        );
      }
      return Promise.reject(new Error(`unexpected: ${path}`));
    }
  );
}

/** The body the create POST sent, or null. */
function lastPost(): Record<string, unknown> | null {
  const post = bridgeCalls(apiRequest)
    .filter((c) => isAccountChannels(c.path) && c.opts.method === "POST")
    .at(-1);
  return (post?.opts.body as Record<string, unknown>) ?? null;
}

/** ⚠ ASYNC, because `ModalShell` PORTALS ON AN EFFECT — the first paint is
 *  `null` and a synchronous query sees an empty body. Awaiting the Name field is
 *  what every other suite over a `StandardDialog` does. */
async function mount(onCreated = vi.fn()) {
  const rendered = renderWithProviders(
    [
      {
        path: "/",
        element: (
          <NewChannelDialog open onOpenChange={vi.fn()} onCreated={onCreated} />
        ),
      },
    ],
    ["/"]
  );
  await screen.findByLabelText("Name");
  return rendered;
}

beforeEach(() => {
  // ⚠ `mockReset`, not `restoreMocks`: `lastPost()` reads recorded CALLS, and a
  // suite that inherited the previous test's POST cannot falsify "sent nothing".
  apiRequest.mockReset();
  installBridge({ apiRequest });
  serve();
});

describe("the form", () => {
  it("offers Name and Description, and the kit's Discard/Create pair", async () => {
    await mount();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    // ⚠ "Discard", not "Cancel" — the kit's own default, and the half of the
    // footer that says this dialog is a `FormDialog` rather than the
    // `StandardDialog` + `DIALOG_BTN_*` pair it was.
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("holds Create disabled until the name is more than whitespace", async () => {
    await mount();
    const create = screen.getByRole("button", { name: "Create" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Fundraise" },
    });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("carries the server's own ceilings at the keyboard — the SCHEMA's, not a copy", async () => {
    // ⚠ PINNED AGAINST THE PARSER ITSELF, not against two typed numbers: the
    // field reads `HomeChannelCreateSchema`'s exported bounds, and what makes
    // that worth anything is that the bound is the one the route enforces.
    await mount();
    const at = (label: string) =>
      Number(screen.getByLabelText(label).getAttribute("maxlength"));
    const name = at("Name");
    const description = at("Description");
    expect(
      HomeChannelCreateSchema.safeParse({ name: "x".repeat(name) }).success
    ).toBe(true);
    expect(
      HomeChannelCreateSchema.safeParse({ name: "x".repeat(name + 1) }).success
    ).toBe(false);
    expect(
      HomeChannelCreateSchema.safeParse({
        name: "A",
        topic: "x".repeat(description),
      }).success
    ).toBe(true);
    expect(
      HomeChannelCreateSchema.safeParse({
        name: "A",
        topic: "x".repeat(description + 1),
      }).success
    ).toBe(false);
  });
});

describe("what it sends", () => {
  it("sends `{ name, topic }` — the DESCRIPTION lands on the `topic` field", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Q3 Fundraise  " },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  Everything about the raise  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // TRIMMED on both, because the server trims and would otherwise refuse the
    // padding its own schema will not count toward the cap.
    await waitFor(() =>
      expect(lastPost()).toEqual({
        name: "Q3 Fundraise",
        topic: "Everything about the raise",
      })
    );
  });

  it("omits `topic` entirely when the description is empty", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Solo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(lastPost()).toEqual({ name: "Solo" }));
  });

  it("Enter in NAME submits; Enter in DESCRIPTION does not", async () => {
    await mount();
    const name = screen.getByLabelText("Name");
    const description = screen.getByLabelText("Description");
    // ⚠ The kit's rule: Enter breaks the line in a `multiline` field and only
    // the verb raises the write. Description first, so a failure here cannot be
    // read as "the name field simply had not been filled in yet".
    fireEvent.change(name, { target: { value: "Solo" } });
    fireEvent.keyDown(description, { key: "Enter" });
    expect(lastPost()).toBeNull();
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(lastPost()).toEqual({ name: "Solo" }));
  });

  it("writes nothing on Enter while the name is empty", async () => {
    await mount();
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
    expect(lastPost()).toBeNull();
  });
});
