"use client";

/**
 * Playground: one real `/v1` call with a test key, and what came back. The call runs on the server, against the
 * project's test data only; the key is held in memory for this call and never stored.
 */
import { FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { PLAYGROUND_OPS, playgroundOp, type PlaygroundOp } from "@/features/device-sdk/portal/playground-ops";
import type { PlaygroundRun } from "@/features/device-sdk/portal/playground-types";
import { Badge, Button, ICON, PillMenu, TwoLine } from "../_design/ui";
import { CodeEditor, FillBody, FillCard, LabeledField, SplitLayout } from "../_design/ui-output";
import { Between, CodeBlock, EmptyState, Page, PageHeader, ProblemAlert, Stack, Text, TextField } from "../_design/ui-page";
import { usePortal } from "../_components/portal-store";

const OPTIONS = PLAYGROUND_OPS.map((op) => ({ value: op.id, label: op.label }));
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const pathOf = (op: PlaygroundOp) => Object.fromEntries(op.pathParams.map((p) => [p.name, p.example]));
const bodyOf = (op: PlaygroundOp) => (op.body === null ? "" : pretty(op.body));

export function PlaygroundSection() {
  const { project, test, setEnv } = usePortal();
  const [key, setKey] = useState("");
  const [opId, setOpId] = useState(PLAYGROUND_OPS[0].id);
  const op = playgroundOp(opId) ?? PLAYGROUND_OPS[0];
  const [path, setPath] = useState<Record<string, string>>(pathOf(op));
  const [query, setQuery] = useState<Record<string, string>>({});
  const [body, setBody] = useState(bodyOf(op));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<PlaygroundRun | null>(null);

  const pick = (id: string) => {
    const next = playgroundOp(id);
    if (!next) return;
    setOpId(id);
    setPath(pathOf(next));
    setQuery({});
    setBody(bodyOf(next));
    setProblem(null);
  };
  const send = async () => {
    setProblem(null);
    let parsed: unknown;
    if (op.body !== null) {
      try {
        parsed = JSON.parse(body);
      } catch {
        setProblem("The body is not valid JSON.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/developers/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: project.id, key: key.trim(), operation: op.id, path_params: path, query, body: parsed }),
      });
      const data = (await res.json().catch(() => null)) as (Partial<PlaygroundRun> & { error?: { message?: string } }) | null;
      if (!res.ok || !data?.response) setProblem(data?.error?.message ?? `The playground answered ${res.status}.`);
      else setRun(data as PlaygroundRun);
    } catch {
      setProblem("Could not reach the playground.");
    } finally {
      setBusy(false);
    }
  };

  if (!test) {
    return (
      <Page fit>
        <PageHeader title="Playground" />
        <EmptyState icon={FlaskConical} title="The Playground uses test data only" action={<Button onClick={() => setEnv("test")}>Switch to Test</Button>} />
      </Page>
    );
  }

  return (
    <Page fit>
      <PageHeader title="Playground" test />
      <SplitLayout
        left={
          <FillCard>
            <Between>
              <TwoLine title={<Text kind="h3">Request</Text>} sub={`${op.method} /v1${op.path}`} />
              <PillMenu stable label={op.label} value={op.id} options={OPTIONS} onChange={pick} />
            </Between>
            <FillBody>
              <Stack>
                <LabeledField label="Test secret key">
                  <TextField type="password" label="Test secret key" placeholder="sk_test_" value={key} onChange={setKey} />
                </LabeledField>
                {op.pathParams.map((p) => (
                  <LabeledField key={p.name} label={p.name}>
                    <TextField label={p.name} value={path[p.name] ?? ""} onChange={(v) => setPath((all) => ({ ...all, [p.name]: v }))} />
                  </LabeledField>
                ))}
                {op.query.map((name) => (
                  <LabeledField key={name} label={name}>
                    <TextField label={name} value={query[name] ?? ""} onChange={(v) => setQuery((all) => ({ ...all, [name]: v }))} />
                  </LabeledField>
                ))}
                {op.body !== null && (
                  <LabeledField label="Body">
                    <CodeEditor label="Body" value={body} onChange={setBody} />
                  </LabeledField>
                )}
                <ProblemAlert problem={problem} />
              </Stack>
            </FillBody>
            <Button block variant="ink" loading={busy} disabled={key.trim() === ""} onClick={() => void send()}>
              <Play {...ICON} aria-hidden="true" />
              Send
            </Button>
          </FillCard>
        }
        right={
          <FillCard>
            <Between>
              <Text kind="h3">Response</Text>
              {run && <Badge tone={run.response.status < 400 ? "ok" : "error"}>{run.response.status}</Badge>}
            </Between>
            <FillBody>
              {run ? (
                <Stack>
                  <CodeBlock title={`${run.request.method} ${run.request.path}, ${run.response.durationMs} ms`}>{pretty(run.response.body)}</CodeBlock>
                  {run.event != null && <CodeBlock title="Log row">{pretty(run.event)}</CodeBlock>}
                </Stack>
              ) : (
                <Text kind="faint">Nothing sent yet</Text>
              )}
            </FillBody>
          </FillCard>
        }
      />
    </Page>
  );
}
