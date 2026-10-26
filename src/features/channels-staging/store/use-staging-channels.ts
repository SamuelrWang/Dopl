"use client";

/**
 * THE IN-MEMORY "SERVER" for /channels staging: the rows, the selection and every write the
 * page can make (post, new thread, launch, 1:1 turn, favourite, mentions read, new channel,
 * revoke link). Nothing persists; a reload is a reset. No fetch, no bridge.
 */

import { useCallback, useMemo, useState } from "react";
import type { AgentColorKey } from "@dopl/contracts";
import type { ChannelMention, ChannelMessage } from "@/features/channels/types";
import type { ScrollTarget } from "@/features/channels/components/message-pane";
import type { AgentLaunchControls } from "@/features/channels/components/use-agents-panel";
import { agentKey } from "@/features/channels/components/agents-model";
import { pickAgentColor } from "@/features/channels/lib/agent-color-pick";
import { mentionMetadata } from "@/features/marketing/components/banner-demo/demo-transcript";
import { CURRENT_USER_ID, VIEWER } from "../data/demo-imports";
import { registerLaunchedAgent, stagingAgentIndex } from "../data/staging-agents";
import {
  NOW_MS,
  channelOf,
  dmOf,
  membersOf,
  ownSessionOf,
  peerOf,
  threadOf,
  U,
} from "../data/staging-builders";
import { STAGING_IDENTITIES } from "../data/staging-query-seed";
import { INITIAL_ROW_ID, initialRows } from "../data/staging-rows";
import type { ChannelFixture, StagingRow } from "../data/staging-fixture-types";
import type { SceneActions } from "../home/channel-scene";

let uid = 0;
const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(uid += 1)}`;
/** 8-char agent instance id, `^[a-z][a-z0-9]{7}$`. */
const nextAgentId = () => `s${(Date.now() + (uid += 1)).toString(36).slice(-7).padStart(7, "0")}`;

function post(
  fixture: ChannelFixture,
  body: string,
  extra: Partial<ChannelMessage> & { threadId?: string | null } = {}
): ChannelMessage {
  const { threadId, metadata, ...rest } = extra;
  const seq = (fixture.messages[fixture.messages.length - 1]?.seq ?? 0) + 1;
  const author = rest.authorUserId === undefined ? CURRENT_USER_ID : rest.authorUserId;
  return {
    id: nextId("stg-post-"),
    seq,
    channelId: fixture.channel.id,
    authorUserId: author,
    authorKind: "user",
    kind: "message",
    body,
    metadata: {
      ...mentionMetadata(body, author),
      ...(threadId ? { threadId } : {}),
      ...(metadata ?? {}),
    },
    clientMsgId: null,
    createdAt: new Date().toISOString(),
    authorName: author ? (VIEWER.displayName ?? null) : null,
    authorAvatarUrl: null,
    ...rest,
  };
}

export function useStagingChannels(onNewChannel?: (channelId: string) => void) {
  const [rows, setRows] = useState<StagingRow[]>(initialRows);
  const [selectedId, setSelectedId] = useState(INITIAL_ROW_ID);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [openAgentKey, setOpenAgentKey] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const [agentsVersion, setAgentsVersion] = useState(0);

  const selected = rows.find((r) => r.rowId === selectedId) ?? rows[0];
  const fixture = selected?.kind === "channel" ? selected : null;
  const thread = fixture?.threads.find((t) => t.id === threadId) ?? null;

  const update = useCallback(
    (fn: (f: ChannelFixture) => ChannelFixture) =>
      setRows((all) =>
        all.map((r) => (r.rowId === selectedId && r.kind === "channel" ? fn(r) : r))
      ),
    [selectedId]
  );

  const select = useCallback((rowId: string) => {
    setSelectedId(rowId);
    setThreadId(null);
    setOpenAgentKey(null);
    setScrollTarget(null);
    // Opening a channel reads it: the dot and the `@ N` pill clear, as on /home.
    setRows((all) =>
      all.map((r) =>
        r.rowId === rowId && r.kind === "channel" ? { ...r, unread: false, mentionsPill: 0 } : r
      )
    );
  }, []);

  const jumpTo = (messageId: string) =>
    setScrollTarget((t) => ({ messageId, nonce: (t?.nonce ?? 0) + 1 }));
  const jumpToMessage = (inThread: string | null, messageId: string) => {
    setThreadId(inThread);
    jumpTo(messageId);
  };

  const launchAgent: AgentLaunchControls["launchAgent"] = async (
    launchThreadId,
    identityId,
    _overrides,
    _agentId,
    _runtime,
    color
  ) => {
    if (!fixture) return { ok: false, reason: "no-channel" };
    const id = nextAgentId();
    const name =
      STAGING_IDENTITIES.find((i) => i.id === identityId)?.name ??
      `Agent ${fixture.sessions.length + 1}`;
    const taken = new Set<string>(
      [...stagingAgentIndex().values()].map((e) => e.color ?? "").filter(Boolean)
    );
    const paint: AgentColorKey = color ?? pickAgentColor(taken) ?? "agent-01";
    registerLaunchedAgent(id, CURRENT_USER_ID, {
      displayName: name,
      description: "Launched on the staging page",
      color: paint,
    });
    setAgentsVersion((v) => v + 1);
    update((f) => {
      const t = f.threads.find((x) => x.id === launchThreadId) ?? null;
      const session = ownSessionOf(f.channel.id, f.channel.name, id, t, 0, 4_000);
      const line = post(f, `${VIEWER.displayName?.split(" ")[0] ?? "You"} launched ${name} from an identity`, {
        kind: "system",
        authorKind: "system",
        authorUserId: null,
        threadId: t?.id ?? null,
      });
      return {
        ...f,
        sessions: [...f.sessions, session],
        serverSessions: [...f.serverSessions, peerOf(f.channel.id, f.channel.name, CURRENT_USER_ID, id, t)],
        messages: [...f.messages, line],
        narration: { ...f.narration, [id]: [dmOf("private", `Launched in #${f.channel.name}. Reading the channel now.`, 0)] },
      };
    });
    return { ok: true, agentId: id };
  };

  const launch: AgentLaunchControls = {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent,
    approveIdentity: () => Promise.resolve({ ok: true }),
  };

  const actions: SceneActions = {
    toggleInfo: () => setInfoOpen((o) => !o),
    toggleFavorite: () => update((f) => ({ ...f, favorited: !f.favorited })),
    openThread: (id) => {
      setThreadId(id);
      setScrollTarget(null);
    },
    exitThread: () => setThreadId(null),
    openAgent: setOpenAgentKey,
    openMention: (m: ChannelMention) => {
      jumpToMessage(m.threadId, m.messageId);
      update((f) => ({
        ...f,
        mentions: f.mentions.map((x) => (x.messageId === m.messageId ? { ...x, read: true } : x)),
      }));
    },
    markMentionsRead: () =>
      update((f) => ({ ...f, mentions: f.mentions.map((x) => ({ ...x, read: true })) })),
    jumpToMessage,
    jumpToSeq: (seq) => {
      const hit = fixture?.messages.find((m) => m.seq === seq);
      if (hit) jumpTo(hit.id);
    },
    sendMessage: (body) =>
      update((f) => ({
        ...f,
        messages: [
          ...f.messages,
          post(f, body, {
            threadId,
            metadata: { source: { kind: "computer", device_id: "stg-dev-mac", label: "Daniel's MacBook Pro", platform: "macos" } },
          }),
        ],
      })),
    createThread: (title, body) =>
      update((f) => {
        const t = threadOf(f.channel.id, nextId("stg-th-"), title || "New thread", CURRENT_USER_ID, 0);
        return {
          ...f,
          // Newest first, as the server lists them.
          threads: [t, ...f.threads],
          messages: [...f.messages, post(f, body || title, { threadId: t.id })],
        };
      }),
    sendDm: (agentId, text) => {
      update((f) => ({
        ...f,
        narration: { ...f.narration, [agentId]: [...(f.narration[agentId] ?? []), { ...dmOf("operator", text, 0), at: Date.now() }] },
      }));
      // A canned answer, so the lane reads as a conversation.
      window.setTimeout(
        () =>
          update((f) => ({
            ...f,
            narration: {
              ...f.narration,
              [agentId]: [...(f.narration[agentId] ?? []), { ...dmOf("private", "Got it. On it now.", 0), at: Date.now() }],
            },
          })),
        700
      );
    },
    launch,
  };

  const createChannel = ({ name, topic }: { name: string; topic: string }) => {
    const id = nextId("stg-ch-");
    const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
    const fresh: ChannelFixture = {
      kind: "channel",
      rowId: `rel:${id}`,
      well: "recent",
      unread: false,
      mentionsPill: 0,
      favorited: false,
      channel: channelOf(id, slug, 1, { topic, createdAt: new Date(NOW_MS).toISOString() }),
      members: membersOf(id, [U.samuel]),
      messages: [],
      threads: [],
      sessions: [],
      peers: [],
      serverSessions: [],
      mentions: [],
      narration: {},
      activity: [],
    };
    onNewChannel?.(id);
    setRows((all) => [fresh, ...all]);
    select(fresh.rowId);
  };

  const revokeLink = (linkId: string) => {
    setRows((all) => all.filter((r) => !(r.kind === "link" && r.link.id === linkId)));
    select(INITIAL_ROW_ID);
  };

  const openSessionKey = useMemo(
    () => (fixture?.sessions.some((s) => agentKey(s) === openAgentKey) ? openAgentKey : null),
    [fixture, openAgentKey]
  );

  return {
    rows,
    selected,
    selectedId,
    fixture,
    thread,
    openAgentKey: openSessionKey,
    infoOpen,
    scrollTarget,
    agentsVersion,
    select,
    actions,
    createChannel,
    revokeLink,
  };
}
