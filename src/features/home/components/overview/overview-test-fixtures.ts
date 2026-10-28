import { vi } from "vitest";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import type { ConnectedDevice } from "@/features/devices/types";
import type { HomeOverview, HomeOverviewSeries } from "@/features/home/overview-types";
import type { HomeNeeds } from "@/features/home/needs-types";
import type { TokenSpendReport } from "@/shared/lib/token-spend-days";
import type { HomeChannelOption } from "./overview-credits";
import type { HomeOverviewReads, OverviewRead } from "./use-home-overview-reads";

export const HOME_CHANNELS: HomeChannelOption[] = [
  { id: "ch-1", workspaceId: "ws-1", name: "Priya Shah", faces: [] },
];

export const OVERVIEW: HomeOverview = {
  range: "month",
  since: "2026-09-01T00:00:00.000Z",
  channels: [
    { workspaceId: "ws-1", name: "Priya Shah", credits: 464, messages: 120 },
    { workspaceId: "ws-2", name: "", credits: 12, messages: 4 },
  ],
  people: [
    { userId: "u-1", name: "Sam Wang", role: "owner", credits: 464 },
    { userId: "u-2", name: "Priya Shah", role: "guest", credits: 12 },
    { userId: "u-3", name: "", role: null, credits: 3 },
  ],
  tools: [
    { tool: "channel", op: "list", calls: 319 },
    { tool: "github", op: "", calls: 52 },
  ],
  scanned: 476,
  truncated: false,
};

export const SERIES: HomeOverviewSeries = {
  range: "month",
  metric: "credits",
  bucket: "day",
  points: Array.from({ length: 7 }, (_, i) => ({ at: `2026-09-0${i + 1}T00:00:00.000Z`, count: i * 10 })),
  truncated: false,
};

export const CREDITS: WorkspaceCreditsStatus = {
  wallet: "personal",
  used: 320,
  limit: 500,
  remaining: 180,
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-10-01T12:00:00.000Z",
  ledgerDrift: 0,
  unmeteredSince: null,
};

export const DEVICES: ConnectedDevice[] = [
  {
    id: "mac-1",
    kind: "computer",
    name: "Studio Mac",
    platform: "macos",
    platformLabel: "macOS",
    online: true,
    lastSeen: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    current: true,
    appVersion: "1.43.0",
  },
  {
    id: "g2",
    kind: "glasses",
    name: "Even G2",
    platform: "even_g2",
    platformLabel: "Even G2",
    online: false,
    lastSeen: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

export const NEEDS: HomeNeeds = {
  decisions: [
    {
      channelId: "ch-1",
      workspaceId: "ws-1",
      channelName: "Priya Shah",
      messageId: "m-1",
      seq: 42,
      threadId: "th-1",
      question: "Ship the migration tonight?",
      author: { kind: "agent", name: "Coder", photo: null, color: "agent-03", runtime: "claude" },
      postedAt: "2026-09-02T10:00:00.000Z",
    },
  ],
  tasks: [
    {
      channelId: "ch-1",
      workspaceId: "ws-1",
      channelName: "Priya Shah",
      taskId: "t-1",
      title: "Review the pricing page",
      status: "in_progress",
      dueAt: "2026-09-05T00:00:00.000Z",
      progress: { done: 1, total: 3 },
      updatedAt: "2026-09-02T09:00:00.000Z",
    },
  ],
  truncated: { decisions: false, tasks: false },
};

export const NO_NEEDS: HomeNeeds = { decisions: [], tasks: [], truncated: { decisions: false, tasks: false } };

export function read<T>(data: T | undefined, more: Partial<OverviewRead<T>> = {}): OverviewRead<T> {
  return {
    data,
    error: null,
    isPending: data === undefined,
    isPlaceholderData: false,
    refetch: vi.fn(),
    ...more,
  };
}

export function spendToday(tokens: number[]): TokenSpendReport {
  return { marks: tokens.map((t) => ({ at: new Date().toISOString(), tokens: t })), truncated: false };
}

export function reads(over: Partial<HomeOverviewReads> = {}): HomeOverviewReads {
  return {
    overview: read(OVERVIEW),
    series: read(SERIES),
    spend: read(spendToday([1_260_000])),
    needs: read(NO_NEEDS),
    wallet: { loading: false, credits: CREDITS, isPaid: false },
    devices: { devices: DEVICES, failed: false },
    preview: null,
    ...over,
  };
}
