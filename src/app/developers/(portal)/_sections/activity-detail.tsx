"use client";

/** One call's story: what it said, each step it took, the devices considered, the raw response. */
import { ExternalLink } from "lucide-react";
import { CALL_KIND_LABEL, type Call, type PortalUser, type WebhookCall } from "@/features/device-sdk/portal/view";
import { Badge, Button, ICON_SM, TwoLine, type Tone } from "../_design/ui";
import { Timeline, type Step } from "../_design/ui-data";
import { FillBody } from "../_design/ui-output";
import { BoxRow, Between, CodeBlock, CopyButton, Grow, ListRow, ReviewWell, Stack, Text } from "../_design/ui-page";
import { BASE, clockOf, ms, since } from "../_components/format";
import { CallStatusBadge, deviceNameOf, userNameOf } from "./activity-parts";

const VERDICT: Record<string, [string, Tone]> = { chosen: ["Chosen", "ok"], eligible: ["Eligible", "neutral"], skipped: ["Skipped", "neutral"] };

export function AttemptList({ attempts }: { attempts: WebhookCall["attempts"] }) {
  return (
    <Stack>
      <Text kind="strong" as="h3">
        Attempts
      </Text>
      <div>
        {attempts.map((a, i) => (
          <ListRow key={a.at + i} line={i < attempts.length - 1}>
            <Badge tone={a.status && a.status < 300 ? "ok" : "error"}>{a.status ?? "No reply"}</Badge>
            <Text clip>{a.note}</Text>
            <Grow />
            <Text kind="smallMuted" nowrap>
              {since(a.at)}
            </Text>
          </ListRow>
        ))}
      </div>
    </Stack>
  );
}

export function CallDetail({ call, users }: { call: Call; users: PortalUser[] }) {
  const user = userNameOf(users, call.userId);
  const device = deviceNameOf(users, call.deviceId);
  const steps: Step[] = call.steps.map((s) => ({ key: s.key, label: s.label, detail: s.detail, at: s.at === undefined ? undefined : ms(s.at), state: s.state }));
  return (
    <>
      <Between>
        <CallStatusBadge status={call.status} />
        <Text kind="smallMuted">{CALL_KIND_LABEL[call.kind]}</Text>
      </Between>
      <TwoLine title={<Text kind="h3">{call.title}</Text>} sub={call.id} />
      <FillBody>
        <ReviewWell
          items={[
            ["When", clockOf(call.at)],
            ["Took", call.latencyMs === null ? "None" : ms(call.latencyMs)],
            ["User", user ?? "None"],
            ["Device", device ?? call.webhook?.endpointName ?? "None"],
          ]}
        />
        {steps.length > 0 && (
          <Stack>
            <Text kind="strong" as="h3">
              Timeline
            </Text>
            <Timeline steps={steps} />
          </Stack>
        )}
        {call.considered.length > 0 && (
          <Stack>
            <Text kind="strong" as="h3">
              Devices considered
            </Text>
            {call.considered.map((c) => (
              <BoxRow key={c.deviceId}>
                <TwoLine title={deviceNameOf(users, c.deviceId) ?? c.deviceId} sub={c.reason} />
                <Grow />
                <Badge tone={VERDICT[c.verdict][1]}>{VERDICT[c.verdict][0]}</Badge>
              </BoxRow>
            ))}
          </Stack>
        )}
        {call.webhook && <AttemptList attempts={call.webhook.attempts} />}
        {call.response != null && <CodeBlock title={call.route ?? "Response"}>{JSON.stringify(call.response, null, 2)}</CodeBlock>}
      </FillBody>
      <Between>
        <CopyButton key={call.id} text={call.id} idle="Copy ID" />
        {call.userId && (
          <Button size="sm" variant="ghost" href={`${BASE}/users/${encodeURIComponent(call.userId)}`}>
            <ExternalLink {...ICON_SM} aria-hidden="true" />
            Open user
          </Button>
        )}
      </Between>
    </>
  );
}
