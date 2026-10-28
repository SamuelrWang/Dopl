/**
 * Each staging channel's artifacts in the product's shape (`types-artifacts.ts ›
 * ChannelFoldedArtifact`): named runs of the channel's own posts, picked by body prefix the way
 * `staging-tasks.ts` links them, so the count, the span and the opened run all come off the
 * transcript. `staging-query-seed.ts` serves them as the Artifacts read and its `?artifact=` arm.
 */

import type { ChannelFoldedArtifact, ChannelMessage } from "@/features/channels/types";
import { AGENT_IDS, DEMO_CHANNEL } from "./demo-imports";
import { EXTRA_AGENT_IDS as X } from "./staging-agents";
import { NOW_MS, U } from "./staging-builders";
import { CHANNEL_IDS } from "./extra-fixtures";
import type { ChannelFixture } from "./staging-fixture-types";

type Spec = {
  id: string;
  name: string;
  summary: string;
  by: string;
  agent?: string;
  /** Body prefixes of the folded posts, one post each. */
  members: readonly string[];
};

export type SeededArtifact = { folded: ChannelFoldedArtifact; messages: ChannelMessage[] };

/** How long after its last post a run is folded. */
const FOLD_DELAY_MS = 60_000;

const SPECS: Record<string, readonly Spec[]> = {
  [DEMO_CHANNEL.id]: [
    { id: "stg-art-logger", name: "Logger migration", summary: "Billing moved last so its alerts kept working. The old logger is deleted.", by: U.samuel, agent: AGENT_IDS.planner, members: ["Moving the last services", "do billing last", "Billing is moved"] },
    { id: "stg-art-flags", name: "Feature flag cleanup", summary: "**11 of 26** flags never changed value. 7 removed, 4 kept for review.", by: U.grace, agent: AGENT_IDS.triage, members: ["Checked every flag", "remove the ones that are always on", "Removed the 7", "two of the off ones"] },
    { id: "stg-art-deps", name: "Dependency audit", summary: "Six unused packages removed. The web build is 280 KB smaller.", by: U.grace, agent: AGENT_IDS.triage, members: ["Ran a dependency audit", "drop them, i'll rerun", "Bundle check after"] },
    { id: "stg-art-backoff", name: "Retry backoff decision", summary: "One backoff table in `shared/retry.ts`, capped at 30 seconds.", by: U.anthony, agent: AGENT_IDS.scout, members: ["the retry backoff numbers", "Found the three copies", "keep the upload one", "All three now read"] },
    { id: "stg-art-survey", name: "Debt survey", summary: "The flaky suite leads with 9 threads in `#eng-help`. Teardown already has a repro.", by: U.samuel, agent: AGENT_IDS.planner, members: ["Read the last two weeks", "Checked the knowledge base"] },
    { id: "stg-art-owners", name: "Who owns what", summary: "Flakes to Debt Triage, teardown to Cleanup Planner, upload retries to Backlog Scout.", by: U.grace, members: ["@debt-triage you have", "Works for me.", "Taking it."] },
    { id: "stg-art-briefs", name: "Teardown briefs", summary: "One brief per symptom, one coder per brief.", by: U.samuel, agent: AGENT_IDS.planner, members: ["@teardown-order-fix the socket", "@end-notice-check", "@wake-replay-trace"] },
  ],
  [CHANNEL_IDS.deploys]: [
    { id: "stg-art-r139", name: "1.39.0 release log", summary: "Held once by a lapsed Apple developer agreement, then shipped.", by: U.samuel, agent: X.deployWatch, members: ["Tracking the 1.39.0", "Apple returned a 403", "accepted it. retry", "Retry passed."] },
    { id: "stg-art-r140", name: "1.40.0 release log", summary: "Green on the first pass, desktop and web.", by: U.samuel, agent: X.deployWatch, members: ["Tracking the 1.40.0", "Suite is green on macOS", "**1.40.0 is live**"] },
    { id: "stg-art-r141", name: "1.41.0 release log", summary: "One notarization retry after the keychain profile expired.", by: U.samuel, agent: X.deployWatch, members: ["Tracking the 1.41.0", "Notarization failed", "**1.41.0 is live**"] },
    { id: "stg-art-h1411", name: "1.41.1 hotfix log", summary: "Sign in loop fixed in the token refresh, shipped on the auth and smoke tests.", by: U.samuel, members: ["sign in loops", "Tracking the 1.41.1", "skip the full suite", "Auth and smoke are green"] },
    { id: "stg-art-b1412", name: "1.41.2 build notices", summary: "The desktop build and the web deploy for 1.41.2.", by: U.samuel, members: ["Build 1.41.2 is green", "Web deploy for `48d98f7b`"] },
    { id: "stg-art-r142", name: "1.42.0 release log", summary: "Suite green, notarized in six minutes, floor raised.", by: U.samuel, agent: X.deployWatch, members: ["Tracking the 1.42.0", "Suite is green. Packing", "Notarization took 6 minutes", "Web deploy for 1.42.0"] },
  ],
  [CHANNEL_IDS.flakes]: [
    { id: "stg-art-ports", name: "Port per worker", summary: "Parallel workers stopped colliding on port 5433. Postgres and Redis both read the worker index.", by: U.samuel, agent: X.quarantine, members: ["Two workers bind", "does that cover the redis", "It does. Postgres"] },
    { id: "stg-art-retries", name: "e2e retry policy", summary: "One retry, with both results in the CI summary.", by: U.grace, agent: AGENT_IDS.triage, members: ["Retries hide", "agreed. show both runs", "Done. The CI summary"] },
    { id: "stg-art-checkout", name: "Checkout suite split", summary: "`e2e/checkout` split in two, each under 5 minutes.", by: U.samuel, agent: X.quarantine, members: ["Measured every suite", "split it in two", "Split into `checkout-cart`"] },
    { id: "stg-art-snapshots", name: "Snapshot font fix", summary: "CI rendered with the fallback font. Pinning it fixed all 12 snapshots.", by: U.grace, agent: AGENT_IDS.triage, members: ["snapshot tests pass locally", "Yes. CI renders", "merged, thanks"] },
    { id: "stg-art-uploads", name: "Upload suite failure counts", summary: "Four tests in `upload.spec.ts` account for 31 of 34 failures.", by: U.grace, members: ["the upload suite failed again", "Pulled the last 40 CI runs"] },
    { id: "stg-art-quarantine", name: "Quarantine findings", summary: "Two timing bugs fixed with the fake clock. Two handed to the teardown thread.", by: U.samuel, agent: X.quarantine, members: ["Opening a thread for the quarantine", "Reran each of the four", "The other two depend"] },
  ],
  [CHANNEL_IDS.apiV2]: [
    { id: "stg-art-sunset", name: "v1 deprecation timeline", summary: "Beta in three weeks, v1 read only eight weeks later, off at quarter end.", by: U.anthony, members: ["proposed dates", "works for us", "Payments signed off"] },
    { id: "stg-art-auth", name: "Auth header rename", summary: "A bearer token replaces `X-Api-Key`. The CLI now sets the header once.", by: U.anthony, agent: X.schemaDiff, members: ["v2 drops `X-Api-Key`", "fix the cli first", "The CLI now sets the header"] },
    { id: "stg-art-inventory", name: "v1 client inventory", summary: "4 clients, 61 endpoints, 212 call sites. The CLI goes first.", by: U.samuel, agent: X.clientGen, members: ["Listed every v1 caller", "start with the cli", "The CLI is mapped"] },
    { id: "stg-art-spec", name: "Spec review answers", summary: "Nine open questions, all answered before the freeze.", by: U.anthony, agent: X.schemaDiff, members: ["Read the draft v2 spec", "answered 7.", "Payments answered both"] },
    { id: "stg-art-breaking", name: "Breaking changes in v2", summary: "The pagination cursor, `created_at` precision and the error envelope.", by: U.anthony, agent: X.schemaDiff, members: ["v2 spec is frozen", "Compared every v1 and v2 payload"] },
    { id: "stg-art-cursor", name: "Cursor change plan", summary: "14 call sites behind `listPaged()`, covered by one wrapper change.", by: U.samuel, agent: X.clientGen, members: ["Opening a thread for the cursor", "v1 returned a page number", "@client-gen regenerate", "Regenerated. 14 call sites"] },
  ],
  [CHANNEL_IDS.design]: [
    { id: "stg-art-icons", name: "Toolbar icon audit", summary: "Three icon sizes down to the kit's 16px token.", by: U.grace, agent: X.uiCritic, members: ["Found three icon sizes", "Every toolbar icon", "much cleaner"] },
    { id: "stg-art-glass", name: "Onboarding blur fix", summary: "The inner blur on step three is gone.", by: U.anthony, members: ["the onboarding glass", "Step three stacks", "approved"] },
    { id: "stg-art-chart", name: "Usage chart palette", summary: "Four greens replaced by the categorical palette.", by: U.samuel, agent: X.tokenSync, members: ["The usage chart uses", "use the palette", "The chart now reads"] },
    { id: "stg-art-contrast", name: "Dark mode contrast pass", summary: "Muted text raised from 3.9:1 to 4.8:1 on every card.", by: U.grace, agent: X.uiCritic, members: ["Checked contrast", "raise the muted token", "Raised the dark muted"] },
    { id: "stg-art-modal", name: "Settings modal review", summary: "Footer buttons on `SMALL_PRIMARY_BUTTON`, both section gaps on one token.", by: U.grace, agent: X.uiCritic, members: ["Reviewed it against", "Opening a thread for the spacing", "Footer pair should take", "Both gaps now read"] },
    { id: "stg-art-signoff", name: "Settings modal sign off", summary: "Checked on staging and approved to ship.", by: U.samuel, members: ["new settings modal is up", "looks right on my end", "ship it"] },
  ],
};

/** The channel's artifacts, newest first (the list read's order). Throws on a prefix that misses. */
export function stagingArtifacts(f: ChannelFixture): SeededArtifact[] {
  const folded = new Set<string>();
  const pick = (spec: Spec, prefix: string): ChannelMessage => {
    const hits = f.messages.filter((m) => m.body.startsWith(prefix));
    const hit = hits.length === 1 ? hits[0] : undefined;
    if (!hit || folded.has(hit.id)) {
      throw new Error(`channels staging: ${spec.id} cannot fold "${prefix}"`);
    }
    folded.add(hit.id);
    return { ...hit, artifactId: spec.id };
  };
  return (SPECS[f.channel.id] ?? [])
    .map((spec): SeededArtifact => {
      const messages = spec.members.map((prefix) => pick(spec, prefix));
      const first = messages[0];
      const last = messages[messages.length - 1];
      const at = Math.min(NOW_MS, new Date(last.createdAt).getTime() + FOLD_DELAY_MS);
      return {
        folded: {
          artifact: {
            id: spec.id,
            channelId: f.channel.id,
            workspaceId: f.channel.workspaceId,
            name: spec.name,
            summary: spec.summary,
            createdBy: spec.by,
            createdByAgent: spec.agent ?? null,
            dissolvedAt: null,
            createdAt: new Date(at).toISOString(),
          },
          count: messages.length,
          firstSeq: first.seq,
          lastSeq: last.seq,
        },
        messages,
      };
    })
    .sort((a, b) => b.folded.artifact.createdAt.localeCompare(a.folded.artifact.createdAt));
}
