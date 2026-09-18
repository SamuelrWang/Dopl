/**
 * The world the fence tests run in: two containers, two channels, and one
 * matching row in every searchable table on each side.
 *
 * Shared by `fence.test.ts` (nothing foreign comes back) and
 * `prefix-match.test.ts` (a half-typed word reaches a body, F-717), so a widening
 * that leaked fails in the same fixture rather than in a drifted copy.
 *
 * Every foreign-side row is an exact twin of its own-side row, so a failed fence
 * shows up as a VISIBLE row rather than a silent absence.
 */

import type { FakeTables } from "./_fake-db";

const ME = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";
const WS_MINE = "33333333-3333-3333-3333-333333333333";
const WS_THEIRS = "44444444-4444-4444-4444-444444444444";
const CH_MINE = "55555555-5555-5555-5555-555555555555";
const CH_THEIRS = "66666666-6666-6666-6666-666666666666";

const CTX = {
  userId: ME,
  credentialSubjectUserId: ME,
  lockedWorkspaceId: null,
};

/**
 * Two containers, two channels, and EVERY searchable table carries one row in
 * each. The query `zephyr` matches all of them, so any leak is a visible row
 * rather than a silent absence.
 */
function world(): FakeTables {
  const pair = <T extends Record<string, unknown>>(
    mine: T,
    theirs: T
  ): T[] => [mine, theirs];
  return {
    workspace_members: [
      { workspace_id: WS_MINE, user_id: ME, status: "active" },
      { workspace_id: WS_THEIRS, user_id: STRANGER, status: "active" },
    ],
    workspaces: pair(
      { id: WS_MINE, name: "Mine", kind: "standard" },
      { id: WS_THEIRS, name: "Theirs", kind: "standard" }
    ),
    channel_members: [
      { channel_id: CH_MINE, user_id: ME, workspace_id: WS_MINE },
      { channel_id: CH_THEIRS, user_id: STRANGER, workspace_id: WS_THEIRS },
    ],
    channels: pair(
      {
        id: CH_MINE,
        name: "zephyr room",
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: CH_THEIRS,
        name: "zephyr room",
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    channel_messages: pair(
      {
        id: "msg-mine",
        seq: 1,
        body: "zephyr shipped",
        kind: "message",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "msg-theirs",
        seq: 2,
        body: "zephyr shipped",
        kind: "message",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        created_at: "2026-09-01T00:00:00Z",
      }
    ),
    channel_tasks: pair(
      {
        id: "thr-mine",
        title: "zephyr plan",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "thr-theirs",
        title: "zephyr plan",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
      }
    ),
    channel_artifacts: pair(
      {
        id: "art-mine",
        name: "zephyr card",
        summary: "",
        channel_id: CH_MINE,
        workspace_id: WS_MINE,
        created_at: "2026-09-01T00:00:00Z",
        dissolved_at: null,
      },
      {
        id: "art-theirs",
        name: "zephyr card",
        summary: "",
        channel_id: CH_THEIRS,
        workspace_id: WS_THEIRS,
        created_at: "2026-09-01T00:00:00Z",
        dissolved_at: null,
      }
    ),
    knowledge_bases: pair(
      {
        id: "kb-mine",
        name: "Handbook",
        workspace_id: WS_MINE,
        visibility: "public",
        created_by: ME,
        deleted_at: null,
      },
      {
        id: "kb-theirs",
        name: "Handbook",
        workspace_id: WS_THEIRS,
        visibility: "public",
        created_by: STRANGER,
        deleted_at: null,
      }
    ),
    knowledge_entries: pair(
      {
        id: "kn-mine",
        title: "zephyr notes",
        body: "zephyr",
        knowledge_base_id: "kb-mine",
        workspace_id: WS_MINE,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "kn-theirs",
        title: "zephyr notes",
        body: "zephyr",
        knowledge_base_id: "kb-theirs",
        workspace_id: WS_THEIRS,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    agent_templates: pair(
      {
        id: "tpl-mine",
        name: "zephyr bot",
        description: null,
        workspace_id: WS_MINE,
        visibility: "workspace",
        created_by: ME,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "tpl-theirs",
        name: "zephyr bot",
        description: null,
        workspace_id: WS_THEIRS,
        visibility: "workspace",
        created_by: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
      }
    ),
    skills: pair(
      {
        id: "sk-mine",
        name: "zephyr skill",
        description: null,
        workspace_id: WS_MINE,
        visibility: "public",
        created_by: ME,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "sk-theirs",
        name: "zephyr skill",
        description: null,
        workspace_id: WS_THEIRS,
        visibility: "public",
        created_by: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    chats: pair(
      {
        id: "ch-mine",
        title: "zephyr chat",
        overview: "",
        workspace_id: WS_MINE,
        visibility: "public",
        owner_id: ME,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      },
      {
        id: "ch-theirs",
        title: "zephyr chat",
        overview: "",
        workspace_id: WS_THEIRS,
        visibility: "public",
        owner_id: STRANGER,
        updated_at: "2026-09-01T00:00:00Z",
        deleted_at: null,
      }
    ),
    profiles: [
      { id: ME, display_name: "zephyr me", email: "me@x.test", avatar_url: null },
      {
        id: STRANGER,
        display_name: "zephyr them",
        email: "them@x.test",
        avatar_url: null,
      },
    ],
  };
}

export {
  ME,
  STRANGER,
  WS_MINE,
  WS_THEIRS,
  CH_MINE,
  CH_THEIRS,
  CTX,
  world,
};
