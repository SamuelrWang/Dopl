"use client";

/** One call's story: what it was, each step it took, the devices considered, the raw response. */
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Button, ICON_SM, TwoLine, type Tone } from "../_design/ui";
import { Timeline, type Step } from "../_design/ui-data";
import { FillBody } from "../_design/ui-output";
import { BoxRow, Between, CodeBlock, Grow, ListRow, ReviewWell, Stack, Text } from "../_design/ui-page";
import { KIND_LABEL, STATUS_LABEL, timelineOf, type Call, type CallStatus } from "../_data/activity";
import { ownedDevice, userById } from "../_data/users";
import { BASE, clock, fmt, ms, since } from "../_components/ui";

const TONE: Partial<Record<CallStatus, Tone>> = { seen: "ok", answered: "ok", ok: "ok", failed: "error", retrying: "warn", expired: "warn" };
const VERDICT: Record<string, [string, Tone]> = { chosen: ["Chosen", "ok"], skipped: ["Skipped", "neutral"], refused: ["Refused", "error"] };

function stepsOf(call: Call): Step[] {
  return timelineOf(call)
    .filter((s) => s.state !== "unknowable")
    .map((s) => ({ key: s.key, label: s.label, detail: s.detail, at: s.at === undefined || s.at === null ? undefined : ms(s.at), state: s.state === "failed" ? "failed" : s.state === "pending" ? "pending" : "done" }));
}

export function CallDetail({ call }: { call: Call }) {
  const [copied, setCopied] = useState<string | null>(null);
  const user = call.userId ? userById(call.userId) : null;
  const device = call.deviceId ? ownedDevice(call.deviceId) : null;
  return (
    <>
      <Between>
        <Badge tone={TONE[call.status] ?? "neutral"} dot>
          {STATUS_LABEL[call.status]}
        </Badge>
        <Text kind="smallMuted">{KIND_LABEL[call.kind]}</Text>
      </Between>
      <TwoLine title={<Text kind="h3">{call.webhook?.event ?? call.title}</Text>} sub={call.id} />
      <FillBody>
        <ReviewWell
          items={[
            ["When", clock(call.at)],
            ["Took", `${fmt(call.latencyMs)} ms`],
            ["User", user?.name ?? "None"],
            ["Device", device?.name ?? "None"],
          ]}
        />
        {call.truncated && <Badge tone="warn">Cut to {call.truncated.kept} of {call.truncated.of} lines</Badge>}
        {call.kind === "delivery" && (
          <Stack>
            <Text kind="strong" as="h3">
              Timeline
            </Text>
            <Timeline steps={stepsOf(call)} />
          </Stack>
        )}
        {call.candidates.length > 0 && (
          <Stack>
            <Text kind="strong" as="h3">
              Devices considered
            </Text>
            {call.candidates.map((c) => (
              <BoxRow key={c.deviceId}>
                <TwoLine title={ownedDevice(c.deviceId)?.name ?? c.deviceId} sub={c.reason} />
                <Grow />
                <Badge tone={VERDICT[c.verdict][1]}>{VERDICT[c.verdict][0]}</Badge>
              </BoxRow>
            ))}
          </Stack>
        )}
        {call.webhook && (
          <Stack>
            <Text kind="strong" as="h3">
              Attempts
            </Text>
            <div>
              {call.webhook.attempts.map((a, i) => (
                <ListRow key={a.at + i} line={i < call.webhook!.attempts.length - 1}>
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
        )}
        {call.http && (
          <CodeBlock title={`${call.http.method} ${call.http.path}`}>
            {JSON.stringify(call.errorCode ? { error: { code: call.errorCode, retryable: call.errorCode === "rate_limited", request_id: call.id } } : { ok: true, status: call.http.status, request_id: call.id }, null, 2)}
          </CodeBlock>
        )}
      </FillBody>
      <Between>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(call.id);
            setCopied(call.id);
          }}
        >
          {copied === call.id ? <Check {...ICON_SM} aria-hidden="true" /> : <Copy {...ICON_SM} aria-hidden="true" />}
          {copied === call.id ? "Copied" : "Copy ID"}
        </Button>
        {user && (
          <Button size="sm" variant="ghost" href={`${BASE}/users/${user.id}`}>
            <ExternalLink {...ICON_SM} aria-hidden="true" />
            Open user
          </Button>
        )}
      </Between>
    </>
  );
}
