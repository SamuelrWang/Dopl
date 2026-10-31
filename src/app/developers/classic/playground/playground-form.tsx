"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { PLAYGROUND_OPS, playgroundOp, type PlaygroundOp } from "@/features/device-sdk/portal/playground-ops";
import type { PlaygroundRun } from "@/features/device-sdk/portal/playground-types";
import { Card, Json, ov } from "../../_components/ui";

const OP_OPTIONS = PLAYGROUND_OPS.map((op) => ({ value: op.id, label: op.label, description: `${op.method} ${op.path}` }));
const FIELD = "card-well h-8 w-full rounded-field px-2.5 font-mono text-small text-text-primary placeholder:text-text-disabled";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const initialPath = (op: PlaygroundOp) => Object.fromEntries(op.pathParams.map((p) => [p.name, p.example]));
const initialBody = (op: PlaygroundOp) => (op.body === null ? "" : pretty(op.body));

/**
 * The playground form. Holds the pasted key in memory only (never in storage, never in the URL),
 * posts one run to `/api/developers/playground` and shows what came back.
 */
export function PlaygroundForm({ projectId, keysHref }: { projectId: string; keysHref: string }) {
  const [key, setKey] = useState("");
  const [opId, setOpId] = useState(PLAYGROUND_OPS[0].id);
  const op = playgroundOp(opId) ?? PLAYGROUND_OPS[0];
  const [pathValues, setPathValues] = useState<Record<string, string>>(initialPath(op));
  const [query, setQuery] = useState<Record<string, string>>({});
  const [body, setBody] = useState(initialBody(op));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<PlaygroundRun | null>(null);

  const pick = (id: string) => {
    const next = playgroundOp(id);
    if (!next) return;
    setOpId(id);
    setPathValues(initialPath(next));
    setQuery({});
    setBody(initialBody(next));
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let parsed: unknown = undefined;
    if (op.body !== null) {
      try {
        parsed = JSON.parse(body);
      } catch {
        setError("The body is not valid JSON.");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/developers/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId, key: key.trim(), operation: op.id, path_params: pathValues, query, body: parsed }),
      });
      const data = (await res.json().catch(() => null)) as (Partial<PlaygroundRun> & { error?: { message?: string } }) | null;
      if (!res.ok || !data?.response) {
        setError(data?.error?.message ?? `The playground answered ${res.status}.`);
        return;
      }
      setRun(data as PlaygroundRun);
    } catch {
      setError("Could not reach the playground. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3.5">
      <Card title="Request">
        <form className="flex flex-col gap-3" onSubmit={submit} aria-label="Playground request">
          <label className="flex flex-col gap-1">
            <span className={ov.cellLabel}>Test secret key</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk_test_…"
              className={FIELD}
            />
            <span className="text-caption text-text-muted">
              Used for this call only, never stored. Copy one from <Link href={keysHref} className={ov.open}>API keys</Link>.
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <span className={ov.cellLabel}>Operation</span>
            <SelectMenu variant="raisedField" options={OP_OPTIONS} value={op.id} onChange={pick} ariaLabel="Operation" />
            <span className="font-mono text-caption text-text-muted">
              {op.method} /v1{op.path}
            </span>
            <span className="text-caption text-text-muted">{op.hint}</span>
          </div>

          {op.pathParams.map((p) => (
            <label key={p.name} className="flex flex-col gap-1">
              <span className={ov.cellLabel}>{p.name}</span>
              <input
                value={pathValues[p.name] ?? ""}
                onChange={(e) => setPathValues((v) => ({ ...v, [p.name]: e.target.value }))}
                maxLength={255}
                className={FIELD}
              />
            </label>
          ))}

          {op.query.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {op.query.map((name) => (
                <label key={name} className="flex flex-col gap-1">
                  <span className={ov.cellLabel}>{name}</span>
                  <input
                    value={query[name] ?? ""}
                    onChange={(e) => setQuery((q) => ({ ...q, [name]: e.target.value }))}
                    maxLength={512}
                    className={FIELD}
                  />
                </label>
              ))}
            </div>
          )}

          {op.body !== null && (
            <label className="flex flex-col gap-1">
              <span className={ov.cellLabel}>Body</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
                rows={8}
                className="card-well w-full rounded-field px-2.5 py-2 font-mono text-caption leading-relaxed text-text-primary"
              />
              {op.idempotent && (
                <span className="text-caption text-text-muted">A fresh idempotency key is added when the body has none.</span>
              )}
            </label>
          )}

          {error && (
            <p role="alert" className="text-caption text-text-primary">
              {error}
            </p>
          )}
          <div>
            <button type="submit" disabled={busy || key.trim() === ""} className={pillButton("ink", "sm")}>
              {busy ? "Running…" : "Send"}
            </button>
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-3.5">
        {run ? (
          <>
            <Card
              title="Response"
              aside={
                <StatusPill tone={run.response.status < 400 ? "live" : "attention"} dot bare={run.response.status < 400}>
                  {run.response.status}
                </StatusPill>
              }
            >
              <span className={cn(ov.rowMeta, "font-mono")}>
                {run.request.method} {run.request.path} · {run.response.durationMs} ms
                {run.response.requestId ? ` · Request-Id ${run.response.requestId}` : ""}
              </span>
              <Json value={run.response.body} />
            </Card>
            <Card title="Log row">
              {run.event ? (
                <Json value={run.event} />
              ) : (
                <EmptyState variant="well" title="This call writes no log row" />
              )}
            </Card>
            <Card title="Sent">
              <span className={cn(ov.rowMeta, "font-mono")}>Authorization: {run.request.authorization}</span>
              {run.request.idempotencyKey && (
                <span className={cn(ov.rowMeta, "font-mono")}>Idempotency-Key: {run.request.idempotencyKey}</span>
              )}
              {run.request.body !== null && <Json value={run.request.body} />}
            </Card>
          </>
        ) : (
          <Card title="Response">
            <EmptyState variant="outline" title="Send a request to see the response and its log row" />
          </Card>
        )}
      </div>
    </div>
  );
}
