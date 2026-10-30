"use client";

/**
 * API keys: which keys can reach this environment, what each may do, which to rotate or revoke, and
 * how to make one. Secret and publishable keys are separate sections because they behave differently:
 * a secret is shown once and rotates, a publishable key stays readable.
 */
import { CheckCircle2, Globe, KeyRound, Plus, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { SearchPill } from "@/shared/ui/search-pill";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100 } from "../_design/components";
import d from "../_design/data.module.css";
import { Segmented } from "../_design/interactive";
import k from "../_design/keys.module.css";
import p from "../_design/page.module.css";
import o from "../_design/surfaces.module.css";
import tokens from "../_design/tokens.module.css";
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
    <div className={cx(p.root, tokens.scope, tokens.u100)}>
      <div className={p.scroller}>
        <div className={p.inner}>
          <header className={b.between}>
            <div className={b.row}>
              <h1 className={b.title}>API keys</h1>
              {state.env === "test" && <span className={cx(b.badge, b.badgeWarn)}>Test data</span>}
            </div>
            <button type="button" className={cx(b.btn, b.ink)} onClick={() => setCreating("any")}>
              <Plus {...ICON_100} aria-hidden="true" />
              Create key
            </button>
          </header>

          <div className={p.stats}>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Active keys</span>
                <span className={b.big}>{fmt(active.length)}</span>
                <span className={b.smallMuted}>
                  {secrets.length} secret, {active.length - secrets.length} publishable
                </span>
              </div>
            </div>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Calls, 7d</span>
                <span className={b.big}>{fmt(calls)}</span>
                <span className={b.smallMuted}>{busiest && calls > 0 ? `${Math.round((busiest.calls7d / calls) * 100)}% from ${busiest.name}` : "None yet"}</span>
              </div>
            </div>
            <div className={b.card}>
              <div className={d.stat}>
                <span className={b.muted}>Oldest secret</span>
                <span className={b.big}>{oldest ? `${days(oldest.createdAt)}d` : "None"}</span>
                <span className={b.smallMuted}>{oldest ? oldest.name : "No secret keys"}</span>
              </div>
            </div>
            <button type="button" aria-pressed={view === "review"} className={cx(b.card, p.statBtn, view === "review" && p.statOn)} onClick={() => setView(view === "review" ? "active" : "review")}>
              <span className={d.stat}>
                <span className={b.muted}>Needs review</span>
                <span className={b.big}>{fmt(unused)}</span>
                <span className={b.smallMuted}>Unused for 30 days</span>
              </span>
            </button>
          </div>

          <div className={b.card}>
            <div className={b.between}>
              <SearchPill value={q} onChange={setQ} label="Search keys" />
              <Segmented label="Key views" options={KEY_VIEWS.map((v) => v.label)} value={KEY_VIEWS.findIndex((v) => v.key === view)} onChange={(i) => setView(KEY_VIEWS[i].key)} />
            </div>
          </div>

          {sections.length === 0 ? (
            <div className={b.card}>
              <div className={o.empty}>
                <span className={b.tile}>{q !== "" ? <SearchX {...ICON_100} aria-hidden="true" /> : <CheckCircle2 {...ICON_100} aria-hidden="true" />}</span>
                <span className={b.h3}>{q !== "" ? "No keys match" : view === "review" ? "Nothing to review" : "No revoked keys"}</span>
                <button type="button" className={b.btn} onClick={clear}>
                  {q !== "" ? "Clear filters" : "Show active keys"}
                </button>
              </div>
            </div>
          ) : (
            sections.map(({ kind, label, add, Glyph }) => {
              const inSection = rows.filter((key) => key.kind === kind);
              const sectionCalls = inSection.reduce((n, key) => n + key.calls7d, 0);
              return (
                <section key={kind} className={c.section} aria-label={label}>
                  <h2 className={c.sectionHead}>
                    <span className={c.sectionMark}>
                      <Glyph {...ICON_100} aria-hidden="true" />
                    </span>
                    <span className={b.h3}>{label}</span>
                    {sectionCalls > 0 && <span className={cx(b.smallMuted, b.num, c.sectionMeta)}>{fmt(sectionCalls)} calls, 7d</span>}
                  </h2>
                  <div className={c.grid}>
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
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
      {creating && <CreateKeyFlow env={state.env} initialKind={creating === "any" ? null : creating} onCreate={create} onClose={() => setCreating(null)} />}
      {rotating && <RotateDialog row={rotating} onCancel={() => setRotating(null)} onConfirm={rotate} />}
      {revoking && <RevokeDialog row={revoking} onCancel={() => setRevoking(null)} onConfirm={revoke} />}
      {revealed && <RevealDialog row={revealed.row} token={revealed.token} onDone={() => setRevealed(null)} />}
      {notice && (
        <div role="status" className={cx(o.toast, o.toastBlack, k.notice)}>
          <span className={b.onInk}>{notice}</span>
        </div>
      )}
    </div>
  );
}
