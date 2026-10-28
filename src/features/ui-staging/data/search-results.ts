/**
 * The playground's search answers: what /home's search would find in the staged story
 * (#tech-debt and its neighbours, the Platform knowledge, the shared identities), served
 * through the product's fixture fetcher as the playground bridge's `/api/search`
 * (`../staging-app-bridge.ts`), so the product header's search runs unchanged. Rows are shaped as the server sends them
 * (`search/server/service-groups.ts › toItem`): a message is titled by its channel, a
 * thread's subtitle is its channel, a channel's is its description. Account scope, so the
 * container-only kinds (members, skills, chats) are absent here as they are on /home.
 */

import { createFixtureFetcher, type FixtureRow } from "@/features/search/search-fixtures";
import { STAGING_HOME_WORKSPACE_ID, STAGING_PEOPLE, daysAgoIso, minsAgoIso } from "../staging-stubs";

const HOME = STAGING_HOME_WORKSPACE_ID;
const [, GRACE, ANTHONY] = STAGING_PEOPLE;

const channel = (id: string, title: string, subtitle: string | undefined, at: string): FixtureRow => ({
  id,
  kind: "channels",
  title,
  ...(subtitle ? { subtitle } : {}),
  containerId: HOME,
  channelId: id,
  updatedAt: at,
});

const message = (id: string, channelId: string, title: string, seq: number, body: string, at: string): FixtureRow => ({
  id,
  kind: "messages",
  title,
  body,
  containerId: HOME,
  channelId,
  seq,
  updatedAt: at,
});

const ROWS: FixtureRow[] = [
  channel("stg-ch-tech-debt", "tech-debt", "Paying down the flaky suite, teardown and retries", minsAgoIso(2)),
  channel("stg-ch-deploys", "deploys", "Build and release notices", minsAgoIso(60 * 27)),
  channel("stg-ch-flaky", "flaky-tests", undefined, minsAgoIso(52)),
  channel("stg-ch-api-v2", "api-v2-migration", undefined, minsAgoIso(60 * 5)),
  channel("stg-ch-design", "design-review", undefined, minsAgoIso(60 * 50)),

  message("stg-msg-9012", "stg-ch-tech-debt", "tech-debt", 9012,
    "The upload suite failed again. Four tests in upload.spec.ts account for 31 of 34 failures.", minsAgoIso(18)),
  message("stg-msg-8977", "stg-ch-tech-debt", "tech-debt", 8977,
    "Retry backoff is one table in shared/retry.ts now, capped at 30 seconds.", minsAgoIso(95)),
  message("stg-msg-8820", "stg-ch-deploys", "deploys", 8820,
    "1.42.0 is live. Suite green, notarized in six minutes, floor raised.", daysAgoIso(2)),
  message("stg-msg-8650", "stg-ch-flaky", "flaky-tests", 8650,
    "CI rendered the snapshots with the fallback font. Pinning it fixed all 12.", daysAgoIso(4)),

  {
    id: "stg-th-teardown",
    kind: "threads",
    title: "Teardown order fix",
    subtitle: "tech-debt",
    containerId: HOME,
    channelId: "stg-ch-tech-debt",
    threadId: "stg-th-teardown",
    updatedAt: minsAgoIso(34),
  },
  {
    id: "stg-th-quarantine",
    kind: "threads",
    title: "Quarantine the upload suite",
    subtitle: "flaky-tests",
    containerId: HOME,
    channelId: "stg-ch-flaky",
    threadId: "stg-th-quarantine",
    updatedAt: daysAgoIso(1),
  },

  {
    id: "stg-art-uploads",
    kind: "artifacts",
    title: "Upload suite failure counts",
    subtitle: "tech-debt",
    containerId: HOME,
    channelId: "stg-ch-tech-debt",
    updatedAt: minsAgoIso(20),
  },
  {
    id: "stg-art-backoff",
    kind: "artifacts",
    title: "Retry backoff decision",
    subtitle: "tech-debt",
    containerId: HOME,
    channelId: "stg-ch-tech-debt",
    updatedAt: daysAgoIso(1),
  },
  {
    id: "stg-art-r142",
    kind: "artifacts",
    title: "1.42.0 release log",
    subtitle: "deploys",
    containerId: HOME,
    channelId: "stg-ch-deploys",
    updatedAt: daysAgoIso(2),
  },

  {
    id: "stg-kb-rollback",
    kind: "knowledge",
    title: "Rollback",
    subtitle: "Platform Runbooks",
    body: "How and when to roll a deploy back. Roll back first, then find the cause.",
    containerId: HOME,
    updatedAt: minsAgoIso(42),
  },
  {
    id: "stg-kb-migrations",
    kind: "knowledge",
    title: "Applying migrations",
    subtitle: "Platform Runbooks",
    body: "Byte-exact, by name, md5-verified. Never db push to production.",
    containerId: HOME,
    updatedAt: daysAgoIso(6),
  },
  {
    id: "stg-kb-pm-search",
    kind: "knowledge",
    title: "Search outage after 1.37.0",
    subtitle: "Incident Postmortems",
    body: "Empty search results for 38 minutes after the release. The retry path swallowed the error.",
    containerId: HOME,
    updatedAt: daysAgoIso(20),
  },

  {
    id: "stg-id-release",
    kind: "agentIdentities",
    title: "Release Captain",
    subtitle: "Runs the release checklist and posts notes in #releases",
    containerId: HOME,
    avatarUrls: GRACE.avatarUrl ? [GRACE.avatarUrl] : undefined,
  },
  {
    id: "stg-id-sql",
    kind: "agentIdentities",
    title: "SQL Reviewer",
    subtitle: "Reads every migration before it ships",
    containerId: HOME,
    avatarUrls: ANTHONY.avatarUrl ? [ANTHONY.avatarUrl] : undefined,
  },
];

export const stagingSearchFetcher = createFixtureFetcher(ROWS);
