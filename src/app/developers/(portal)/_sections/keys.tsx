"use client";

/**
 * API keys: which keys can reach this environment, what each may do, which to rotate or revoke, and
 * how to make one. Secret and publishable keys are separate sections because they behave differently.
 * Revoking is final: there is no undo, because a revoked key may have leaked.
 */
import { CheckCircle2, Globe, KeyRound, Plus, SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { KeyView } from "@/features/device-sdk/portal/view";
import { errorText, portalCall } from "../../_lib/client-api";
import { Button, ICON, SearchField, Segmented } from "../_design/ui";
import { Between, CardSection, EmptyState, Page, PageHeader, Toast, Toolbar } from "../_design/ui-page";
import { fmt } from "../_components/format";
import { usePortal } from "../_components/portal-store";
import { AddKeyCard, KeyCard } from "./keys-card";
import { CreateKeyFlow, RevealDialog, RevokeDialog, RotateDialog } from "./keys-dialogs";
import { KEY_VIEWS, keepsKey, type KeyKind, type KeyTab } from "./keys-model";

const SECTIONS = [
  { kind: "secret", label: "Secret keys", add: "New secret key", Glyph: KeyRound },
  { kind: "publishable", label: "Publishable keys", add: "New publishable key", Glyph: Globe },
] as const;

export function KeysSection({ keys }: { keys: KeyView[] }) {
  const router = useRouter();
  const { test, env, project, canManage } = usePortal();
  const [view, setView] = useState<KeyTab>("active");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<KeyKind | "any" | null>(null);
  const [rotating, setRotating] = useState<KeyView | null>(null);
  const [revoking, setRevoking] = useState<KeyView | null>(null);
  const [revealed, setRevealed] = useState<{ row: KeyView; token: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => keys.filter((key) => keepsKey(key, view, q)), [keys, view, q]);
  const browsing = q === "" && view === "active";
  const sections = SECTIONS.filter((section) => browsing || rows.some((key) => key.kind === section.kind));
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const create = async ({ name, kind, scopes }: { name: string; kind: KeyKind; scopes: string[] }) => {
    const body = kind === "secret" ? { env, kind, name, scopes } : { env, kind, name };
    const made = await portalCall<{ secret: string }>(`/api/developers/projects/${project.id}/keys`, "POST", body);
    router.refresh();
    return made.secret;
  };
  const rotate = async (graceHours: number) => {
    if (!rotating) return;
    const row = rotating;
    setRotating(null);
    try {
      const made = await portalCall<{ secret: string }>(`/api/developers/keys/${row.id}/rotate`, "POST", { grace_hours: graceHours });
      setRevealed({ row, token: made.secret });
      router.refresh();
    } catch (e) {
      say(errorText(e, "Could not rotate this key."));
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    const row = revoking;
    setRevoking(null);
    try {
      await portalCall(`/api/developers/keys/${row.id}`, "DELETE");
      say(`${row.name} revoked`);
      router.refresh();
    } catch (e) {
      say(errorText(e, "Could not revoke this key."));
    }
  };
  const clear = () => {
    setQ("");
    setView("active");
  };

  return (
    <Page
      overlays={
        <>
          {creating && <CreateKeyFlow env={env} initialKind={creating === "any" ? null : creating} onCreate={create} onClose={() => setCreating(null)} />}
          {rotating && <RotateDialog row={rotating} onCancel={() => setRotating(null)} onConfirm={(hours) => void rotate(hours)} />}
          {revoking && <RevokeDialog row={revoking} onCancel={() => setRevoking(null)} onConfirm={() => void revoke()} />}
          {revealed && <RevealDialog row={revealed.row} env={env} token={revealed.token} onDone={() => setRevealed(null)} />}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="API keys"
        test={test}
        action={
          canManage && (
            <Button variant="ink" onClick={() => setCreating("any")}>
              <Plus {...ICON} aria-hidden="true" />
              Create key
            </Button>
          )
        }
      />

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
                <KeyCard key={row.id} row={row} canManage={canManage} onRotate={() => setRotating(row)} onRevoke={() => setRevoking(row)} />
              ))}
              {browsing && canManage && inSection.length === 0 && <AddKeyCard label={add} env={test ? "Test" : "Live"} onClick={() => setCreating(kind)} />}
            </CardSection>
          );
        })
      )}
    </Page>
  );
}
