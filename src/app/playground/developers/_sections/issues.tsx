"use client";

/**
 * Issues: what is broken, who it reaches and the fix. Failures are grouped by cause, worst first. The
 * selected one fills the right, with the one action that resolves it.
 */
import { ArrowRight, BellOff, Bell, CheckCircle2, ExternalLink, FileText, Link2, RefreshCw, Unplug, Webhook, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ICON, Initials, Segmented, TwoLine, initialsOf } from "../_design/ui";
import { AvatarStack, FillBody, FillCard, InkFoot, InkPanel, InkQuote, PickRow, ScrollArea, SplitLayout } from "../_design/ui-output";
import { EmptyState, Grow, ListRow, Page, PageHeader, ReviewWell, Stack, TableHead, Text, Toast } from "../_design/ui-page";
import { issuesFor, type Issue, type IssueId } from "../_data/issues";
import { userById } from "../_data/users";
import { usePortal } from "../_components/portal-store";
import { BASE, fmt } from "../_components/ui";

const GLYPH: Record<IssueId, LucideIcon> = { stale_pairing: Unplug, needs_relink: Link2, overflow: FileText, webhook_failing: Webhook };
const WHY: Record<IssueId, string> = {
  stale_pairing: "These users have an old pairing that no longer answers. Deliveries try it first and are refused before reaching a live device.",
  needs_relink: "These users' connections expired. Nothing reaches their devices until they link again.",
  overflow: "Messages are longer than the rules allow, so the end of each one is cut on the display.",
  webhook_failing: "Your endpoint keeps answering with an error, so these events never reach your backend.",
};
const VIEWS = ["Open", "Muted"];
const SHOWN_FACES = 4;

export function IssuesSection() {
  const router = useRouter();
  const { state, update } = usePortal();
  const [view, setView] = useState(0);
  const [picked, setPicked] = useState<IssueId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const all = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).sort((a, b) => b.count - a.count);
  const isMuted = (i: Issue) => state.mutedIssues.includes(i.id);
  const rows = all.filter((i) => isMuted(i) === (view === 1));
  const issue = rows.find((i) => i.id === picked) ?? rows[0] ?? null;

  const fix = (i: Issue) => {
    if (i.id === "stale_pairing") {
      const stale = i.userIds.flatMap((id) => userById(id)?.devices.filter((d) => d.state === "stale").map((d) => d.id) ?? []);
      update((s) => ({ ...s, revoked: [...s.revoked, ...stale] }));
      say(`Revoked ${stale.length} stale pairings`);
    } else if (i.id === "needs_relink") {
      const stuck = i.userIds.flatMap((id) => userById(id)?.devices.filter((d) => d.state === "needs_relink").map((d) => d.id) ?? []);
      update((s) => ({ ...s, deviceStates: { ...s.deviceStates, ...Object.fromEntries(stuck.map((d) => [d, "online" as const])) } }));
      say(`Relink links sent to ${i.userIds.length} users`);
    } else if (i.id === "overflow") {
      router.push(`${BASE}/devices/even_realities?tab=receives`);
    } else {
      router.push(`${BASE}/webhooks`);
    }
  };
  const mute = (i: Issue) => update((s) => ({ ...s, mutedIssues: isMuted(i) ? s.mutedIssues.filter((x) => x !== i.id) : [...s.mutedIssues, i.id] }));

  return (
    <Page fit overlays={notice && <Toast>{notice}</Toast>}>
      <PageHeader title="Issues" test={state.env === "test"} action={<Segmented label="Issue views" options={VIEWS} value={view} onChange={setView} />} />
      {rows.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={view === 0 ? "Nothing needs you" : "No muted issues"} />
      ) : (
        <SplitLayout
          left={
            <FillCard flush>
              <TableHead>
                <Text kind="h3">Grouped by cause</Text>
                <Text kind="smallMuted" num>
                  {rows.length} {view === 0 ? "open" : "muted"}
                </Text>
              </TableHead>
              <ScrollArea>
                {rows.map((i) => {
                  const Glyph = GLYPH[i.id];
                  return (
                    <PickRow key={i.id} selected={issue?.id === i.id} onClick={() => setPicked(i.id)}>
                      <span className="sr-only">{i.title}</span>
                      <Glyph {...ICON} aria-hidden="true" />
                      <TwoLine title={i.title} sub={`${fmt(i.count)} ${i.countLabel}`} />
                      <Grow />
                      <AvatarStack>
                        {i.userIds.slice(0, 3).map((id) => (
                          <Initials key={id} small text={initialsOf(userById(id)?.name ?? id)} />
                        ))}
                      </AvatarStack>
                    </PickRow>
                  );
                })}
              </ScrollArea>
            </FillCard>
          }
          right={
            issue && (
              <InkPanel
                fill
                title={issue.title}
                icon={<Badge tone="warn">{issue.code}</Badge>}
                action={
                  <Button size="sm" onClick={() => mute(issue)}>
                    {isMuted(issue) ? <Bell {...ICON} aria-hidden="true" /> : <BellOff {...ICON} aria-hidden="true" />}
                    {isMuted(issue) ? "Unmute" : "Mute"}
                  </Button>
                }
              >
                <InkQuote>{WHY[issue.id]}</InkQuote>
                <ReviewWell
                  items={[
                    ["Impact", `${fmt(issue.count)} ${issue.countLabel}`],
                    ["First seen", issue.firstSeen],
                  ]}
                />
                <FillBody>
                  <Stack>
                    <Text kind="strong" as="h3">
                      {issue.userIds.length} users affected
                    </Text>
                    <div>
                      {issue.userIds.slice(0, SHOWN_FACES).map((id, n) => {
                        const user = userById(id);
                        return (
                          <ListRow key={id} line={n < Math.min(issue.userIds.length, SHOWN_FACES) - 1}>
                            <Initials small text={initialsOf(user?.name ?? id)} />
                            <TwoLine strong={false} title={user?.name ?? id} sub={id} />
                            <Grow />
                            <Button size="sm" variant="ghost" href={`${BASE}/users/${id}`}>
                              Open
                            </Button>
                          </ListRow>
                        );
                      })}
                    </div>
                  </Stack>
                </FillBody>
                <InkFoot>
                  {issue.callIds.length > 0 && (
                    <Button variant="ghost" href={`${BASE}/activity?call=${issue.callIds[0]}`}>
                      <ExternalLink {...ICON} aria-hidden="true" />
                      Latest call
                    </Button>
                  )}
                  <Grow />
                  <Button variant="ink" onClick={() => fix(issue)}>
                    {issue.id === "stale_pairing" || issue.id === "needs_relink" ? <RefreshCw {...ICON} aria-hidden="true" /> : <ArrowRight {...ICON} aria-hidden="true" />}
                    {issue.action}
                  </Button>
                </InkFoot>
              </InkPanel>
            )
          }
        />
      )}
    </Page>
  );
}
