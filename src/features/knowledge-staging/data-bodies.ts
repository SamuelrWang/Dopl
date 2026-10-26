/** UI-STAGING FAKE DATA: the markdown bodies of the seeded knowledge entries (`data.ts`). */

export const ROLLBACK = `## When to roll back

Roll back when error rate on the API tier crosses **2% for five minutes**, or p95 latency doubles against the previous deploy.

## Steps

1. Announce in #tech-debt: \`rolling back <sha>\`.
2. Run \`dopl deploy rollback --to previous\`.
3. Watch the API dashboard until error rate is back under 0.5%.
4. Open a postmortem stub in **Incident Postmortems**.

## Who to call

- Primary on-call (PagerDuty rotation \`platform-primary\`)
- Grace Kim for anything touching the database
`;

export const DEPLOY = `## Before you deploy

- CI green on \`master\`
- Migrations reviewed and applied to staging
- No open Sev-1

## Deploy

Run \`dopl deploy --env prod\`. The pipeline pauses after canary; promote once the canary dashboard is clean for ten minutes.

## After

Post the release notes link in #releases.
`;

export const MIGRATIONS = `## Rules

- Match migrations by **name**, never by position.
- Apply byte-exact; never \`db push\` against production.
- md5-verify the file before and after applying.

## Backslashes

The SQL transport mangles backslashes. Use \`E''\` strings or dollar quoting.
`;

export const ESCALATION = `## Severity

| Sev | Meaning | Page |
| --- | --- | --- |
| 1 | Customers down | Immediately |
| 2 | Degraded | Within 15 min |
| 3 | Cosmetic | Next business day |

## Escalation path

Primary → Secondary → Engineering manager → CTO.
`;

export const HANDOFF = "Short checklist for the Monday on-call handoff. Still needs headings.";

export const PM_SEARCH = `## Summary

Search returned empty results for 38 minutes after the 1.37.0 release.

## Timeline

- 14:02 Release promoted
- 14:09 First customer report
- 14:40 Index rebuilt, search restored

## Root cause

The search index migration ran before the backfill, so the new column was empty.

## Action items

- Gate index migrations on backfill completion
- Add a synthetic search probe
`;

export const PM_SIGNOUT = `## Summary

Desktop users were signed out every few hours.

## Root cause

The browser kept a copy of the desktop session; a stale refresh revoked the whole token family.

## Fix

Separate the desktop session from the browser's cookie jar (PR #17).
`;

export const STANDUP = `## Monday

- Ontology staging page in progress
- Knowledge + Identities staging next

## Blockers

None.
`;

export const ONE_ON_ONE = `## Grace — 1:1

### Wins

Shipped the channel routing fixes.

### Growth

Wants to own the release process end to end.

## Follow-ups

- Share the release checklist
- Pair on the notarization script
`;

export const IDEA_GLASSES = `## Idea

Glasses as a first-class channel member: agents can push a card to the lens and wait for a tap.

## Open questions

- Rate limits per device
- What happens when the glasses are offline
`;

export const ROLE_BRIEF = `## The role

Senior platform engineer. Owns deploys, the desktop release pipeline and on-call health.

## Must-haves

- Has run a production Postgres upgrade
- Comfortable in TypeScript and Swift

## Nice-to-haves

- Electron packaging and notarization
`;

export const LOOP_ONSITE = `## Onsite loop

1. System design (60 min)
2. Pairing on a real bug (60 min)
3. Values + collaboration (45 min)

## Scorecard

Rate each signal 1–4. A single 1 is a no-hire.
`;

export const READING = `## Queue

- *Designing Data-Intensive Applications*
- *The Mythical Man-Month*
- *Working in Public*

## Done

- *Shape Up*
`;

export const MIG_PLAN = `## Phases

1. Replica on 17 alongside 15
2. Shadow reads for one week
3. Cutover in a maintenance window

## Risks

Extension versions — \`pg_cron\` and \`pgvector\` must be upgraded first.
`;
