"use client";

/**
 * API keys: which keys can reach this environment, what each may do, which to rotate or revoke, and
 * how to make one. Secret and publishable keys are separate sections because they behave differently:
 * a secret is shown once and rotates, a publishable key stays readable.
 */
import { CheckCircle2, Globe, KeyRound, Plus, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, ICON, SearchField, Segmented, StatCard } from "../_design/ui";
import { Between, CardSection, EmptyState, Page, PageHeader, StatRow, Toast, Toolbar } from "../_design/ui-page";
import { MEMBERS, minsAgo } from "../_data/company";
import type { ApiKeyRow } from "../_data/misc";
import { usePortal } from "../_components/portal-store";
import { fmt } from "../_components/ui";
import { AddKeyCard, KeyCard } from "./keys-card";
import { CreateKeyFlow, RevealDialog, RevokeDialog, RotateDialog, copyText } from "./keys-dialogs";
import { KEY_VIEWS, days, isUnused, keepsKey, newKey, rotated, type KeyKind, type KeyView } from "./keys-model";

const SECTIONS = [
  { kind: "secret", label: "Secret keys", add: "New secret key", Glyph: KeyRound },
  { kind: "publishable", label: "Publishable keys", add: "New publishable key", Glyph: Globe },
] as const;
/** The demo has one signed-in person, the same one the sidebar shows. */
const ME = MEMBERS[2];

export function KeysSection() {
  const { state, update } = usePortal();
  const [view, setView] = useState<KeyView>("active");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<KeyKind | "any" | null>(null);
  const [rotating, setRotating] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [revealed, setRevealed] = useState<{ row: ApiKeyRow; token: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const all = useMemo(() => state.keys.filter((key) => key.env === state.env), [state.keys, state.env]);
  const rows = useMemo(() => all.filter((key) => keepsKey(key, view, q)), [all, view, q]);
  const active = all.filter((key) => !key.revoked);
  const secrets = active.filter((key) => key.kind === "secret");
  const calls = active.reduce((n, key) => n + key.calls7d, 0);
  const busiest = active.reduce<ApiKeyRow | null>((top, key) => (!top || key.calls7d > top.calls7d ? key : top), null);
  const oldest = secrets.reduce<ApiKeyRow | null>((top, key) => (!top || key.createdAt < top.createdAt ? key : top), null);
  const unused = active.filter(isUnused).length;
  const envLabel = state.env === "live" ? "Live" : "Test";
  const browsing = q === "" && view === "active";
  const sections = SECTIONS.filter((section) => browsing || rows.some((key) => key.kind === section.kind));

  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const seed = () => state.keys.length + 1;
  const replace = (row: ApiKeyRow) => update((s) => ({ ...s, keys: s.keys.map((key) => (key.id === row.id ? row : key)) }));
  const create = ({ name, kind, scopes }: { name: string; kind: KeyKind; scopes: string[] }) => {
    const { row, token } = newKey({ name, kind, scopes, env: state.env, by: ME.name, seed: seed() });
    update((s) => ({ ...s, keys: [row, ...s.keys] }));
    return token;
  };
  const rotate = (graceHours: number) => {
    if (!rotating) return;
    const next = rotated(rotating, graceHours, seed() + rotating.prefix.charCodeAt(9));
    replace(next.row);
    setRotating(null);
    setRevealed(next);
  };
  const revoke = () => {
    if (!revoking) return;
    replace({ ...revoking, revoked: true, revokedAt: minsAgo(0) });
    setRevoking(null);
    say(`${revoking.name} revoked`);
  };
  const clear = () => {
    setQ("");
    setView("active");
  };

  return (
    <Page
      overlays={
        <>
          {creating && <CreateKeyFlow env={state.env} initialKind={creating === "any" ? null : creating} onCreate={create} onClose={() => setCreating(null)} />}
          {rotating && <RotateDialog row={rotating} onCancel={() => setRotating(null)} onConfirm={rotate} />}
          {revoking && <RevokeDialog row={revoking} onCancel={() => setRevoking(null)} onConfirm={revoke} />}
          {revealed && <RevealDialog row={revealed.row} token={revealed.token} onDone={() => setRevealed(null)} />}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="API keys"
        test={state.env === "test"}
        action={
          <Button variant="ink" onClick={() => setCreating("any")}>
            <Plus {...ICON} aria-hidden="true" />
            Create key
          </Button>
        }
      />

      <StatRow>
        <StatCard label="Active keys" value={fmt(active.length)} hint={`${secrets.length} secret, ${active.length - secrets.length} publishable`} />
        <StatCard label="Calls, 7d" value={fmt(calls)} hint={busiest && calls > 0 ? `${Math.round((busiest.calls7d / calls) * 100)}% from ${busiest.name}` : "None yet"} />
        <StatCard label="Oldest secret" value={oldest ? `${days(oldest.createdAt)}d` : "None"} hint={oldest ? oldest.name : "No secret keys"} />
        <StatCard label="Needs review" value={fmt(unused)} hint="Unused for 30 days" pressed={view === "review"} onClick={() => setView(view === "review" ? "active" : "review")} />
      </StatRow>

      <Toolbar>
        <Between>
          <SearchField hug value={q} placeholder="Search keys" onChange={setQ} />
          <Segmented label="Key views" options={KEY_VIEWS.map((v) => v.label)} value={KEY_VIEWS.findIndex((v) => v.key === view)} onChange={(i) => setView(KEY_VIEWS[i].key)} />
        </Between>
      </Toolbar>

      {sections.length === 0 ? (
        <EmptyState icon={q !== "" ? SearchX : CheckCircle2} title={q !== "" ? "No keys match" : view === "review" ? "Nothing to review" : "No revoked keys"} action={<Button onClick={clear}>{q !== "" ? "Clear filters" : "Show active keys"}</Button>} />
      ) : (
        sections.map(({ kind, label, add, Glyph }) => {
          const inSection = rows.filter((key) => key.kind === kind);
          const sectionCalls = inSection.reduce((n, key) => n + key.calls7d, 0);
          return (
            <CardSection key={kind} icon={<Glyph {...ICON} aria-hidden="true" />} title={label} meta={sectionCalls > 0 && `${fmt(sectionCalls)} calls, 7d`}>
              {inSection.map((row) => (
                <KeyCard
                  key={row.id}
                  row={row}
                  onRotate={() => setRotating(row)}
                  onRevoke={() => setRevoking(row)}
                  onCopy={(token) => {
                    copyText(token);
                    say("Key copied");
                  }}
                />
              ))}
              {browsing && inSection.length === 0 && <AddKeyCard label={add} env={envLabel} onClick={() => setCreating(kind)} />}
            </CardSection>
          );
        })
      )}
    </Page>
  );
}
