/**
 * The channels the landing demo only LISTS in its column (`demo-home-rows.ts › HOME_ROWS`):
 * deploys, flaky-tests, api-v2-migration, design-review and the unclaimed link to Mira
 * Castellanos. The demo has no transcript for them, so these are INVENTED in the demo's voice
 * (members lower-case and brief, agents in full sentences) and in its shapes. Row ids, names,
 * wells and marks are the demo's own. Each transcript opens with its older threads
 * (`staging-history.ts`).
 */

import {
  U,
  activityOf,
  channelOf,
  dmOf,
  inboundOf,
  membersOf,
  mentionOf,
  minsAgo,
  ownSessionOf,
  peerOf,
  postsFor,
  settleThreads,
  threadOf,
} from "./staging-builders";
import {
  apiV2History,
  deploysHistory,
  designReviewHistory,
  flakyTestsHistory,
} from "./staging-history";
import { EXTRA_AGENT_IDS as X } from "./staging-agents";
import { AGENT_IDS } from "./demo-imports";
import type { ChannelFixture, LinkFixture } from "./staging-fixture-types";

export const CHANNEL_IDS = {
  deploys: "stg-ch-deploys",
  flakes: "stg-ch-flakes",
  apiV2: "stg-ch-apiv2",
  design: "stg-ch-design",
} as const;

/** Old enough for the history's oldest thread. */
const CREATED = minsAgo(60 * 24 * 60);

/* ── #deploys — pinned, solo: the viewer and his Deploy Watch ───────── */

export function deploysFixture(): ChannelFixture {
  const id = CHANNEL_IDS.deploys;
  const name = "deploys";
  const post = postsFor(id, "dep");
  const past = deploysHistory(id, post);
  const release = threadOf(id, "stg-th-release", "Release 1.42.0", U.samuel, 60 * 30);
  const current = [
    post(U.samuel, "Build 1.41.2 is green on macOS. Notarized and published to the feed", 60 * 52, { agent: X.deployWatch }),
    post(U.samuel, "Web deploy for `48d98f7b` finished. Vercel reports success", 60 * 49, { agent: X.deployWatch }),
    post(U.samuel, "ship 1.42 tonight if the suite stays green", 60 * 31, { device: "computer" }),
    post(U.samuel, "Tracking the 1.42.0 release here", 60 * 30, { agent: X.deployWatch, thread: release.id }),
    post(U.samuel, "Suite is green. Packing the desktop build now", 60 * 29, { agent: X.deployWatch, thread: release.id }),
    post(U.samuel, "Notarization took 6 minutes. **1.42.0 is live** on the feed and the floor is raised", 60 * 28, { agent: X.deployWatch, thread: release.id }),
    post(U.samuel, "Web deploy for 1.42.0 finished. Vercel reports success on the release commit", 60 * 27, { agent: X.deployWatch }),
  ];
  const messages = [...past.messages, ...current];
  const watch = ownSessionOf(id, name, X.deployWatch, null, 60 * 53, 21_000, "idle");
  return {
    kind: "channel",
    rowId: "rel:demo-ws-weekly",
    well: "pinned",
    unread: false,
    mentionsPill: 0,
    favorited: true,
    channel: channelOf(id, name, 1, { topic: "Build and release notices", createdAt: CREATED }),
    members: membersOf(id, [U.samuel]),
    messages,
    threads: settleThreads([release, ...past.threads], messages),
    sessions: [watch],
    peers: [],
    serverSessions: [peerOf(id, name, U.samuel, X.deployWatch, null, "idle")],
    mentions: [],
    narration: {
      [X.deployWatch]: [
        dmOf("operator", "post every build here, and ping me only if one goes red", 60 * 53 * 60),
        dmOf("private", "Will do. Green builds get one line each, red ones get the failing step and a link.", 60 * 53 * 60 - 30),
        dmOf("operator", "how long did notarizing take tonight?", 60 * 28 * 60),
        dmOf("private", "Six minutes, about average for the last ten releases.", 60 * 28 * 60 - 20),
      ],
    },
    activity: activityOf([1, 0, 2, 1, 0, 0, 3, 1, 1, 0, 2, 4, 1, 0, 0, 1, 2, 3, 1, 0, 0, 1, 2, 2, 1, 0, 0, 3, 2, 1, 4]),
  };
}

/* ── #flaky-tests — Grace and the viewer; two unread tags of him ────── */

export function flakyTestsFixture(): ChannelFixture {
  const id = CHANNEL_IDS.flakes;
  const name = "flaky-tests";
  const post = postsFor(id, "flk");
  const past = flakyTestsHistory(id, post);
  const quarantine = threadOf(id, "stg-th-quarantine", "Quarantine list", U.samuel, 70);
  const current = [
    post(U.grace, "the upload suite failed again on main. third time this morning", 95, { device: "computer" }),
    post(U.grace, "Pulled the last 40 CI runs. Four tests account for **31 of 34** failures, all in `upload.spec.ts`", 90, { agent: AGENT_IDS.triage }),
    post(U.samuel, "can we quarantine those four while we look?", 80, { device: "computer" }),
    post(U.samuel, "Opening a thread for the quarantine list", 70, { agent: X.quarantine, thread: quarantine.id }),
    post(U.samuel, "Reran each of the four 50 times. Two fail only when the retry timer fires during teardown", 66, { agent: X.quarantine, thread: quarantine.id }),
    post(U.samuel, "The other two depend on wall-clock time. Swapping in the fake clock fixes both locally", 62, { agent: X.quarantine, thread: quarantine.id }),
    post(U.grace, "@Daniel two of the four are timing bugs, not real failures. OK to land the fake clock change?", 58, { agent: AGENT_IDS.triage }),
    post(U.grace, "@Daniel the other two overlap with session teardown, so I'd hand them to your thread in #tech-debt", 52, { agent: AGENT_IDS.triage }),
  ];
  const messages = [...past.messages, ...current];
  const runner = ownSessionOf(id, name, X.quarantine, quarantine, 75, 52_000);
  const triage = peerOf(id, name, U.grace, AGENT_IDS.triage);
  return {
    kind: "channel",
    rowId: "rel:demo-ws-flakes",
    well: "recent",
    unread: false,
    mentionsPill: 2,
    favorited: false,
    channel: channelOf(id, name, 2, { topic: "Tests that fail without a code change.", createdAt: CREATED }),
    members: membersOf(id, [U.samuel, U.grace]),
    messages,
    threads: settleThreads([quarantine, ...past.threads], messages),
    sessions: [runner],
    peers: [triage],
    serverSessions: [triage, peerOf(id, name, U.samuel, X.quarantine, quarantine)],
    mentions: [mentionOf(current[7], false), mentionOf(current[6], false)],
    narration: {
      [X.quarantine]: [
        dmOf("operator", "rerun the four worst ones until you can say why they fail", 74 * 60),
        dmOf("private", "Starting with 50 runs each. I'll post the split in the thread.", 73 * 60),
        inboundOf(current[1], 72 * 60),
        dmOf("operator", "anything that needs a code change, write it up first", 64 * 60),
        dmOf("private", "Understood. The fake clock swap is test-only, so that one is ready to land.", 63 * 60),
      ],
    },
    activity: activityOf([0, 1, 3, 0, 2, 4, 2, 0, 0, 5, 7, 3, 1, 0, 0, 2, 6, 9, 4, 1, 0, 0, 3, 8, 10, 6, 2, 0, 0, 4, 8]),
  };
}

/* ── #api-v2-migration — Anthony and the viewer; an invitation is out ─ */

export function apiV2Fixture(): ChannelFixture {
  const id = CHANNEL_IDS.apiV2;
  const name = "api-v2-migration";
  const post = postsFor(id, "api");
  const past = apiV2History(id, post);
  const cursor = threadOf(id, "stg-th-cursor", "Pagination cursor change", U.anthony, 60 * 6);
  const current = [
    post(U.anthony, "v2 spec is frozen. we can start moving clients over", 60 * 8, { device: "phone" }),
    post(U.anthony, "Compared every v1 and v2 payload. **3 breaking changes**: the pagination cursor, `created_at` precision, and the error envelope", 60 * 7, { agent: X.schemaDiff }),
    post(U.samuel, "@schema-diff the cursor one worries me most. what breaks?", 60 * 6.5, { device: "computer" }),
    post(U.anthony, "Opening a thread for the cursor change", 60 * 6, { agent: X.schemaDiff, thread: cursor.id }),
    post(U.anthony, "v1 returned a page number, v2 returns an opaque cursor. Any client storing the page number breaks on resume", 60 * 5.9, { agent: X.schemaDiff, thread: cursor.id }),
    post(U.samuel, "@client-gen regenerate the typed client against the frozen spec and flag every call site that stores a page", 60 * 5.8, { agent: AGENT_IDS.planner, thread: cursor.id }),
    post(U.samuel, "Regenerated. 14 call sites store a page number, all behind `listPaged()`. One wrapper change covers them", 60 * 5.5, { agent: X.clientGen, thread: cursor.id }),
    post(U.anthony, "nice, that's way smaller than i expected", 60 * 5, { device: "phone" }),
  ];
  const messages = [...past.messages, ...current];
  const gen = ownSessionOf(id, name, X.clientGen, cursor, 60 * 6, 64_000);
  const diff = peerOf(id, name, U.anthony, X.schemaDiff);
  return {
    kind: "channel",
    rowId: "rel:demo-ws-apiv2",
    well: "recent",
    invited: true,
    unread: true,
    mentionsPill: 0,
    favorited: false,
    channel: channelOf(id, name, 2, { topic: "Moving every client to the v2 API.", createdAt: CREATED }),
    members: membersOf(id, [U.samuel, U.anthony]),
    messages,
    threads: settleThreads([cursor, ...past.threads], messages),
    sessions: [gen],
    peers: [diff],
    serverSessions: [diff, peerOf(id, name, U.samuel, X.clientGen, cursor)],
    mentions: [],
    narration: {
      [X.clientGen]: [
        inboundOf(current[5], 60 * 5.8 * 60),
        dmOf("private", "Regenerating from the frozen spec now. I'll list every call site that keeps a page number.", 60 * 5.7 * 60),
        dmOf("operator", "keep the wrapper change separate from the regen", 60 * 5.4 * 60),
        dmOf("private", "Two commits then: the regenerated client, and the `listPaged()` change on top.", 60 * 5.3 * 60),
      ],
    },
    activity: activityOf([0, 0, 1, 0, 0, 2, 1, 0, 0, 0, 3, 2, 0, 0, 0, 1, 4, 2, 0, 0, 0, 0, 1, 5, 3, 1, 0, 0, 0, 2, 6]),
  };
}

/* ── #design-review — all three; the Earlier well (collapsed by default) ─ */

export function designReviewFixture(): ChannelFixture {
  const id = CHANNEL_IDS.design;
  const name = "design-review";
  const post = postsFor(id, "dsn");
  const past = designReviewHistory(id, post);
  const modal = threadOf(id, "stg-th-modal", "Settings modal spacing", U.grace, 60 * 52);
  const current = [
    post(U.grace, "new settings modal is up on staging. eyes please", 60 * 56, { device: "computer" }),
    post(U.grace, "Reviewed it against the design language. The footer buttons are 36px where popups use 30px, and two section gaps differ", 60 * 54, { agent: X.uiCritic }),
    post(U.grace, "Opening a thread for the spacing fixes", 60 * 52, { agent: X.uiCritic, thread: modal.id }),
    post(U.grace, "Footer pair should take `SMALL_PRIMARY_BUTTON`. Section gaps should both be 20px", 60 * 51.8, { agent: X.uiCritic, thread: modal.id }),
    post(U.samuel, "Both gaps now read from the same token. Pushed to the branch", 60 * 51, { agent: X.tokenSync, thread: modal.id }),
    post(U.anthony, "looks right on my end now", 60 * 50.5, { device: "phone" }),
    post(U.samuel, "ship it", 60 * 50, { device: "glasses" }),
  ];
  const messages = [...past.messages, ...current];
  const sync = ownSessionOf(id, name, X.tokenSync, modal, 60 * 53, 30_000, "ended");
  const critic = peerOf(id, name, U.grace, X.uiCritic, null, "idle");
  return {
    kind: "channel",
    rowId: "rel:demo-ws-design",
    well: "earlier",
    unread: false,
    mentionsPill: 0,
    favorited: false,
    channel: channelOf(id, name, 3, { topic: "Screens going out, reviewed before they ship.", createdAt: CREATED }),
    members: membersOf(id, [U.samuel, U.grace, U.anthony]),
    messages,
    threads: settleThreads([modal, ...past.threads], messages),
    sessions: [sync],
    peers: [critic],
    serverSessions: [critic, peerOf(id, name, U.samuel, X.tokenSync, modal, "ended")],
    mentions: [],
    narration: {
      [X.tokenSync]: [
        inboundOf(current[3], 60 * 51.8 * 60),
        dmOf("private", "Both gaps were literals. Moved them onto the section-gap token and pushed.", 60 * 51 * 60),
      ],
    },
    activity: activityOf([2, 3, 0, 0, 1, 4, 2, 1, 0, 0, 2, 3, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
  };
}

/* ── The unclaimed link — "Mira Castellanos · Not yet claimed" ─────── */

export function miraLinkFixture(): LinkFixture {
  return {
    kind: "link",
    rowId: "link:demo-link-1",
    well: "earlier",
    name: "Mira Castellanos",
    link: {
      id: "demo-link-1",
      url: "https://www.usedopl.com/link/stg-7f3a9c2e",
      label: "Mira Castellanos",
      createdAt: minsAgo(60 * 74),
      expiresAt: minsAgo(-60 * 24 * 4),
      maxUses: 1,
      useCount: 0,
      revokedAt: null,
      grantedRole: "guest",
    },
  };
}
