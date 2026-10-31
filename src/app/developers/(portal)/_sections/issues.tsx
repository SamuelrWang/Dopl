"use client";

/** Issues: what is broken, who it reaches and where to fix it. Failures are grouped by cause, worst first; the selected one fills the right. */
import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Link2, Unplug, Webhook, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Issue, IssueKind, PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Button, ICON, Initials, TwoLine, initialsOf } from "../_design/ui";
import { AvatarStack, FillBody, FillCard, InkFoot, InkPanel, InkQuote, PickRow, ScrollArea, SplitLayout } from "../_design/ui-output";
import { EmptyState, Grow, ListRow, Page, PageHeader, ReviewWell, Stack, TableHead, Text } from "../_design/ui-page";
import { BASE, fmt, since } from "../_components/format";
import { usePortal } from "../_components/portal-store";

const GLYPH: Record<IssueKind, LucideIcon> = { stale_pairing: Unplug, needs_relink: Link2, webhook_failing: Webhook, error_code: AlertCircle };
const SHOWN_FACES = 4;

export function IssuesSection({ issues, users }: { issues: Issue[]; users: PortalUser[] }) {
  const { test } = usePortal();
  const [picked, setPicked] = useState<string | null>(null);
  const issue = issues.find((i) => i.id === picked) ?? issues[0] ?? null;
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  return (
    <Page fit>
      <PageHeader title="Issues" test={test} />
      {!issue ? (
        <EmptyState icon={CheckCircle2} title="Nothing needs you" />
      ) : (
        <SplitLayout
          left={
            <FillCard flush>
              <TableHead>
                <Text kind="h3">Grouped by cause</Text>
                <Text kind="smallMuted" num>
                  {issues.length} open
                </Text>
              </TableHead>
              <ScrollArea>
                {issues.map((i) => {
                  const Glyph = GLYPH[i.kind];
                  return (
                    <PickRow key={i.id} selected={issue.id === i.id} onClick={() => setPicked(i.id)}>
                      <Glyph {...ICON} aria-hidden="true" />
                      <TwoLine title={i.title} sub={`${fmt(i.count)} ${i.countLabel}`} />
                      <Grow />
                      <AvatarStack>
                        {i.userIds.slice(0, 3).map((id) => (
                          <Initials key={id} small text={initialsOf(nameOf(id))} />
                        ))}
                      </AvatarStack>
                    </PickRow>
                  );
                })}
              </ScrollArea>
            </FillCard>
          }
          right={
            <InkPanel fill title={issue.title} icon={<Badge tone="warn">{issue.code}</Badge>}>
              <InkQuote>{issue.why}</InkQuote>
              <ReviewWell
                items={[
                  ["Impact", `${fmt(issue.count)} ${issue.countLabel}`],
                  ["First seen", issue.firstSeen ? since(issue.firstSeen) : "Now"],
                ]}
              />
              <FillBody>
                {issue.userIds.length > 0 && (
                  <Stack>
                    <Text kind="strong" as="h3">
                      {issue.userIds.length} {issue.userIds.length === 1 ? "user" : "users"} affected
                    </Text>
                    <div>
                      {issue.userIds.slice(0, SHOWN_FACES).map((id, n) => (
                        <ListRow key={id} line={n < Math.min(issue.userIds.length, SHOWN_FACES) - 1}>
                          <Initials small text={initialsOf(nameOf(id))} />
                          <TwoLine strong={false} title={nameOf(id)} sub={nameOf(id) === id ? undefined : id} />
                          <Grow />
                          <Button size="sm" variant="ghost" href={`${BASE}/users/${encodeURIComponent(id)}`}>
                            Open
                          </Button>
                        </ListRow>
                      ))}
                    </div>
                  </Stack>
                )}
              </FillBody>
              <InkFoot>
                {issue.latestCallId && (
                  <Button variant="ghost" href={`${BASE}/activity?call=${issue.latestCallId}`}>
                    <ExternalLink {...ICON} aria-hidden="true" />
                    Latest call
                  </Button>
                )}
                <Grow />
                <Button variant="ink" href={BASE + issue.action.href}>
                  <ArrowRight {...ICON} aria-hidden="true" />
                  {issue.action.label}
                </Button>
              </InkFoot>
            </InkPanel>
          }
        />
      )}
    </Page>
  );
}
