/**
 * Each staging channel's OLDER threads, so the Threads tab files cards into every recency well.
 * Posted ahead of the channel's current transcript (lower seqs, older stamps), in the same voice:
 * members lower case and brief, agents in full sentences. Invented, like `extra-fixtures.ts`.
 */

import type { ChannelMessage, ChannelThread } from "@/features/channels/types";
import { U, threadOf, type Post, type PostOpts } from "./staging-builders";
import { EXTRA_AGENT_IDS as X } from "./staging-agents";
import { AGENT_IDS } from "./demo-imports";

export type History = { threads: ChannelThread[]; messages: ChannelMessage[] };

/** Minutes. */
const DAY = 60 * 24;

type Turn = { by: string; at: number; body: string; agent?: string; device?: PostOpts["device"] };
type PastThread = { id: string; title: string; by: string; turns: readonly Turn[] };

/** Every turn posted oldest first, so seqs ascend with time across the threads. */
function history(channelId: string, post: Post, past: readonly PastThread[]): History {
  const threads = past.map((t) =>
    threadOf(channelId, t.id, t.title, t.by, Math.max(...t.turns.map((turn) => turn.at)))
  );
  const messages = past
    .flatMap((t) => t.turns.map((turn) => ({ ...turn, thread: t.id })))
    .sort((a, b) => b.at - a.at)
    .map(({ by, at, body, agent, device, thread }) =>
      post(by, body, at, { agent, thread, device: agent ? undefined : (device ?? "computer") })
    );
  return { threads, messages };
}

export function techDebtHistory(channelId: string, post: Post): History {
  const { triage, planner, scout } = AGENT_IDS;
  return history(channelId, post, [
    {
      id: "stg-th-logger",
      title: "Logger migration",
      by: U.samuel,
      turns: [
        { by: U.samuel, agent: planner, at: 41 * DAY, body: "Moving the last services off the old logger. **14 call sites** left, all in `billing/`" },
        { by: U.samuel, at: 41 * DAY - 25, body: "do billing last, it has the most alerts wired to the old format" },
        { by: U.samuel, agent: planner, at: 40 * DAY, body: "Billing is moved and its alerts read the new format. The old logger has no callers left, so it is deleted" },
      ],
    },
    {
      id: "stg-th-flags",
      title: "Dead feature flags",
      by: U.grace,
      turns: [
        { by: U.grace, agent: triage, at: 12 * DAY, body: "Checked every flag in `flags.ts` against 90 days of evaluations. **11 of 26** never change value" },
        { by: U.grace, at: 12 * DAY - 40, body: "remove the ones that are always on. ask before touching the always off ones" },
        { by: U.grace, agent: triage, at: 12 * DAY - 90, body: "Removed the 7 that are always on in one change. The 4 that are always off are listed here for review" },
        { by: U.anthony, at: 11 * DAY, device: "phone", body: "two of the off ones are mine. both can go" },
      ],
    },
    {
      id: "stg-th-deps",
      title: "Unused dependencies",
      by: U.grace,
      turns: [
        { by: U.grace, agent: triage, at: 5 * DAY, body: "Ran a dependency audit. **6 packages** have no imports left, and two of them pull in a second copy of `date-fns`" },
        { by: U.anthony, at: 5 * DAY - 30, device: "phone", body: "drop them, i'll rerun the bundle check after" },
        { by: U.anthony, agent: scout, at: 5 * DAY - 180, body: "Bundle check after the removal: the web build is **280 KB** smaller and the duplicate `date-fns` is gone" },
      ],
    },
    {
      id: "stg-th-backoff",
      title: "Retry backoff constants",
      by: U.anthony,
      turns: [
        { by: U.anthony, at: 3 * DAY, device: "phone", body: "the retry backoff numbers are copied in three places. can we keep one" },
        { by: U.anthony, agent: scout, at: 3 * DAY - 20, body: "Found the three copies in `upload/retry.ts`, `sync/queue.ts` and `session/reconnect.ts`. They disagree on the cap" },
        { by: U.samuel, at: 3 * DAY - 45, body: "keep the upload one, it's the only one with tests" },
        { by: U.anthony, agent: scout, at: 3 * DAY - 120, body: "All three now read `RETRY_BACKOFF` from `shared/retry.ts`. The cap is **30 seconds** everywhere" },
      ],
    },
  ]);
}

export function deploysHistory(channelId: string, post: Post): History {
  const watch = X.deployWatch;
  const by = U.samuel;
  return history(channelId, post, [
    {
      id: "stg-th-r139",
      title: "Release 1.39.0",
      by,
      turns: [
        { by, agent: watch, at: 36 * DAY, body: "Tracking the 1.39.0 release here" },
        { by, agent: watch, at: 36 * DAY - 30, body: "Apple returned a 403 on upload. The developer agreement needs accepting again before notarization can run" },
        { by, at: 36 * DAY - 50, body: "accepted it. retry" },
        { by, agent: watch, at: 36 * DAY - 70, body: "Retry passed. **1.39.0 is live** on the feed and the floor is raised" },
      ],
    },
    {
      id: "stg-th-r140",
      title: "Release 1.40.0",
      by,
      turns: [
        { by, agent: watch, at: 16 * DAY, body: "Tracking the 1.40.0 release here" },
        { by, agent: watch, at: 16 * DAY - 25, body: "Suite is green on macOS. The desktop build is signed and notarizing" },
        { by, agent: watch, at: 16 * DAY - 40, body: "**1.40.0 is live** on the feed. Web deploy reports success on the release commit" },
      ],
    },
    {
      id: "stg-th-r141",
      title: "Release 1.41.0",
      by,
      turns: [
        { by, agent: watch, at: 9 * DAY, body: "Tracking the 1.41.0 release here" },
        { by, agent: watch, at: 9 * DAY - 30, body: "Notarization failed on an expired keychain profile. Recreated it and the retry passed" },
        { by, agent: watch, at: 9 * DAY - 50, body: "**1.41.0 is live** on the feed and the floor is raised to 1.41.0" },
      ],
    },
    {
      id: "stg-th-h1411",
      title: "Hotfix 1.41.1",
      by,
      turns: [
        { by, at: 4 * DAY, body: "sign in loops on a fresh install. need a hotfix tonight" },
        { by, agent: watch, at: 4 * DAY - 10, body: "Tracking the 1.41.1 hotfix here. The fix is one line in the token refresh" },
        { by, at: 4 * DAY - 20, device: "phone", body: "skip the full suite. run auth and the desktop smoke test only" },
        { by, agent: watch, at: 4 * DAY - 60, body: "Auth and smoke are green. **1.41.1 is live** and the floor is unchanged" },
      ],
    },
  ]);
}

export function flakyTestsHistory(channelId: string, post: Post): History {
  const { triage } = AGENT_IDS;
  const runner = X.quarantine;
  return history(channelId, post, [
    {
      id: "stg-th-ports",
      title: "Port collisions in parallel runs",
      by: U.samuel,
      turns: [
        { by: U.samuel, agent: runner, at: 33 * DAY, body: "Two workers bind port 5433 at once about once in 60 runs. Moving to one port per worker" },
        { by: U.grace, at: 33 * DAY - 30, body: "does that cover the redis tests too" },
        { by: U.samuel, agent: runner, at: 33 * DAY - 90, body: "It does. Postgres and Redis both read their port from the worker index now" },
      ],
    },
    {
      id: "stg-th-retries",
      title: "Retry policy for e2e",
      by: U.grace,
      turns: [
        { by: U.grace, agent: triage, at: 19 * DAY, body: "Retries hide **40%** of e2e failures. Proposing one retry, with the first failure still reported" },
        { by: U.samuel, at: 19 * DAY - 30, body: "agreed. show both runs in the summary" },
        { by: U.grace, agent: triage, at: 19 * DAY - 120, body: "Done. The CI summary lists a retried test with both results" },
      ],
    },
    {
      id: "stg-th-checkout",
      title: "Checkout suite timeout",
      by: U.samuel,
      turns: [
        { by: U.samuel, agent: runner, at: 6 * DAY, body: "Measured every suite over 200 runs. `e2e/checkout` is the only one near its 10 minute budget" },
        { by: U.samuel, at: 6 * DAY - 20, body: "split it in two rather than raising the budget" },
        { by: U.samuel, agent: runner, at: 6 * DAY - 150, body: "Split into `checkout-cart` and `checkout-pay`. Each finishes in under 5 minutes" },
      ],
    },
    {
      id: "stg-th-snapshots",
      title: "Snapshot drift on CI",
      by: U.grace,
      turns: [
        { by: U.grace, at: 2 * DAY, body: "snapshot tests pass locally and fail on CI. fonts?" },
        { by: U.grace, agent: triage, at: 2 * DAY - 25, body: "Yes. CI renders with the fallback font, so every text node measures 2px wider. Pinning the font in test setup fixes all 12" },
        { by: U.grace, at: 2 * DAY - 40, body: "merged, thanks" },
      ],
    },
  ]);
}

export function apiV2History(channelId: string, post: Post): History {
  const diff = X.schemaDiff;
  const gen = X.clientGen;
  return history(channelId, post, [
    {
      id: "stg-th-sunset",
      title: "Deprecation timeline",
      by: U.anthony,
      turns: [
        { by: U.anthony, at: 40 * DAY, device: "phone", body: "proposed dates: v2 beta in three weeks, v1 read only eight weeks later, v1 off at quarter end" },
        { by: U.samuel, at: 40 * DAY - 60, body: "works for us. put the dates in the KB once payments signs off" },
        { by: U.anthony, agent: diff, at: 39 * DAY, body: "Payments signed off. The dates are in the KB under *API v2 timeline*" },
      ],
    },
    {
      id: "stg-th-auth",
      title: "Auth header rename",
      by: U.anthony,
      turns: [
        { by: U.anthony, agent: diff, at: 16 * DAY, body: "v2 drops `X-Api-Key` for a bearer token. Every client sets the header once, except the CLI, which sets it in two places" },
        { by: U.anthony, at: 16 * DAY - 20, device: "phone", body: "fix the cli first so the rename is one line everywhere" },
        { by: U.samuel, agent: gen, at: 16 * DAY - 90, body: "The CLI now sets the header once in `request.ts`. The rename is a one line change in each client" },
      ],
    },
    {
      id: "stg-th-inventory",
      title: "Client inventory",
      by: U.samuel,
      turns: [
        { by: U.samuel, agent: gen, at: 9 * DAY, body: "Listed every v1 caller: **4 clients**, 61 endpoints and 212 call sites. The web app holds 70% of them" },
        { by: U.samuel, at: 9 * DAY - 30, body: "start with the cli, it's the smallest" },
        { by: U.samuel, agent: gen, at: 9 * DAY - 100, body: "The CLI is mapped. 18 call sites, and none of them paginate" },
      ],
    },
    {
      id: "stg-th-spec",
      title: "v2 spec review",
      by: U.anthony,
      turns: [
        { by: U.anthony, agent: diff, at: 3 * DAY, body: "Read the draft v2 spec against the v1 clients. **9 open questions**, listed here by risk" },
        { by: U.anthony, at: 3 * DAY - 60, device: "phone", body: "answered 7. the last two need the payments team" },
        { by: U.anthony, agent: diff, at: 2 * DAY, body: "Payments answered both. Nothing is open, so the spec can freeze" },
      ],
    },
  ]);
}

export function designReviewHistory(channelId: string, post: Post): History {
  const critic = X.uiCritic;
  const sync = X.tokenSync;
  return history(channelId, post, [
    {
      id: "stg-th-icons",
      title: "Toolbar icon sizes",
      by: U.grace,
      turns: [
        { by: U.grace, agent: critic, at: 48 * DAY, body: "Found three icon sizes in the toolbar: 14, 16 and 18px. The kit specifies 16" },
        { by: U.samuel, agent: sync, at: 48 * DAY - 60, body: "Every toolbar icon now reads the icon size token" },
        { by: U.anthony, at: 48 * DAY - 90, device: "phone", body: "much cleaner" },
      ],
    },
    {
      id: "stg-th-glass",
      title: "Onboarding glass panels",
      by: U.anthony,
      turns: [
        { by: U.anthony, at: 22 * DAY, device: "phone", body: "the onboarding glass looks muddy on step three" },
        { by: U.grace, agent: critic, at: 22 * DAY - 30, body: "Step three stacks two blurred layers. Removing the inner blur keeps the look and clears the haze" },
        { by: U.grace, at: 22 * DAY - 45, body: "approved" },
      ],
    },
    {
      id: "stg-th-chart",
      title: "Usage chart palette",
      by: U.samuel,
      turns: [
        { by: U.grace, agent: critic, at: 11 * DAY, body: "The usage chart uses four greens that read as one series. The data viz palette has a validated categorical set" },
        { by: U.samuel, at: 11 * DAY - 20, body: "use the palette, and keep green for live status only" },
        { by: U.samuel, agent: sync, at: 11 * DAY - 70, body: "The chart now reads the categorical palette tokens. Green is gone from it" },
      ],
    },
    {
      id: "stg-th-contrast",
      title: "Dark mode contrast",
      by: U.grace,
      turns: [
        { by: U.grace, agent: critic, at: 5 * DAY, body: "Checked contrast on every dark surface. Muted text on cards is **3.9:1**, under the 4.5 target" },
        { by: U.grace, at: 5 * DAY - 30, body: "raise the muted token, not each screen" },
        { by: U.samuel, agent: sync, at: 5 * DAY - 80, body: "Raised the dark muted token. Every card now reads 4.8:1" },
      ],
    },
  ]);
}
