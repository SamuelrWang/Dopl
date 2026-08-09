import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Chat } from "../types";

const chatDetail = vi.hoisted(() => ({
  detail: null as unknown,
  status: "loading" as string,
}));

vi.mock("../client/hooks", () => ({
  useChatDetail: () => ({ ...chatDetail, retry: () => {} }),
}));

const { DetailPane } = await import("./detail-pane");

/**
 * The archive's transcript slot said "Loading transcript…" in muted copy —
 * one of the text loaders §5 calls the real problem. It ghosts the bubble
 * column now, sized from the message count the header already printed.
 */

function chat(over: Partial<Chat> = {}): Chat {
  return {
    id: "c-1",
    folderId: null,
    title: "Migration planning",
    overview: "Planned the desktop migration.",
    pinned: false,
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    owner: { userId: "u-me", displayName: "Ada", avatarUrl: null, email: null },
    source: "claude-code",
    project: null,
    format: "summarized",
    sessionDate: "2026-08-01",
    exportedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    messageCount: 12,
    deliverables: [],
    learnings: [],
    ...over,
  } as Chat;
}

function render(over: Partial<Chat> = {}, pinPending = false) {
  return renderToStaticMarkup(
    <DetailPane
      chat={chat(over)}
      folder={null}
      workspaceId="w-1"
      workspaceSlug="acme"
      currentUserId="u-me"
      isAdmin
      totalChats={3}
      onShareChange={async () => {}}
      onTogglePin={async () => {}}
      pinPending={pinPending}
      onDelete={async () => {}}
    />
  );
}

describe("chats DetailPane — transcript loading", () => {
  it("no longer says 'Loading transcript…'", () => {
    expect(render()).not.toContain("Loading transcript…");
  });

  it("ghosts the bubble column with the shared kit", () => {
    const html = render();
    const ghosts = html.match(/data-slot="skeleton"/g) ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(ghosts.length);
    // user turns indent right, exactly as MessageList renders them
    expect(html).toContain("ml-12");
  });

  it("caps the ghost column so a 200-message chat doesn't fill the screen", () => {
    const big = render({ messageCount: 200 });
    const five = render({ messageCount: 5 });
    expect((big.match(/rounded-\[10px\] border/g) ?? []).length).toBe(
      (five.match(/rounded-\[10px\] border/g) ?? []).length
    );
  });

  it("still ghosts something for a one-message chat", () => {
    expect(render({ messageCount: 1 })).toContain('data-slot="skeleton"');
  });

  it("announces the load", () => {
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading transcript");
  });
});

/**
 * A pin toggle used to dim the star for two network hops and only THEN flip
 * it, so two quick clicks both read the stale value and sent the same PATCH
 * twice. The write is optimistic now: the star shows its new state at once
 * and the control is inert for the round trip, which is what stops a second,
 * contradicting PATCH from racing the first.
 */
describe("chats DetailPane — pin", () => {
  it("shows the new state and marks the control pending", () => {
    const html = render({ pinned: true }, true);
    expect(html).toContain('aria-label="Unpin"');
    expect(html).toContain("data-pending");
    expect(html).toContain("pointer-events-none");
  });

  it("leaves the control interactive when nothing is in flight", () => {
    expect(render({ pinned: true })).not.toContain("data-pending");
  });
});
