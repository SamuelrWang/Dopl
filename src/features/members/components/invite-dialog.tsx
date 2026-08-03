"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Link2, RotateCcw } from "lucide-react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose section tree reaches `next/navigation`, and this dialog
// is mounted by the members page the desktop SPA reuses (a `next/*` module
// anywhere in that graph fails the vite build).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { SearchField } from "@/shared/ui/search-field";
import { cn } from "@/shared/lib/utils";
import { ApiError, apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import type { TeamView } from "@/features/teams/types";
import type { AssignableRole } from "../types";

interface Props {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace id — scopes the Solo-limit upgrade flow's billing calls. */
  workspaceId?: string;
  /** Teams the inviter can pre-assign — invitees auto-join on accept. */
  teams?: TeamView[];
  /** Called after a successful invite so the parent can refresh lists. */
  onInvited?: (email: string) => void;
}

const ROLES: Array<{ value: AssignableRole; label: string; hint: string }> = [
  {
    value: "admin",
    label: "Admin",
    hint: "Can change workspace settings and invite new members to the workspace",
  },
  { value: "member", label: "Member", hint: "Can use everything: KBs, skills, and canvas" },
  { value: "viewer", label: "Viewer", hint: "Read-only access to the workspace" },
];

/**
 * Shareable invite link: anyone with the link can request to join; an
 * admin approves from the members page. The link is permanent until
 * reset (resetting invalidates previously shared copies).
 */
function ShareLinkSection({
  workspaceSlug,
  open,
}: {
  workspaceSlug: string;
  open: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);
  const queryClient = useQueryClient();

  const linkPath = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-link`;
  // Fetches only while the dialog is open; errors keep the loading state
  // (same as the old hand-rolled effect). staleTime 0: every open must
  // revalidate — another admin may have rotated the link, and a cached
  // token would be a dead invite.
  const linkQuery = useApiQuery<{ token: string }>(linkPath, {
    enabled: open,
    staleTime: 0,
  });
  const token = linkQuery.data?.token ?? null;

  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/join/${token}`
      : null;

  async function reset() {
    setBusy(true);
    try {
      const body = await apiRequest<{ token: string }>(linkPath, { method: "POST" });
      queryClient.setQueryData([linkPath, undefined, undefined], body);
    } catch {
      /* keep the current link on failure */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      <div className="flex items-center justify-between">
        <label className="text-small font-medium text-text-tertiary">
          Or share an invite link
        </label>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={busy || !token}
          title="Reset link — previously shared copies stop working"
          className="flex items-center gap-1 text-label uppercase tracking-wider text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 cursor-pointer"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 h-9 rounded-md bg-surface-raised-2 border border-border-strong min-w-0">
          <Link2 size={13} className="shrink-0 text-text-muted" />
          <input
            readOnly
            value={url ?? "Generating link…"}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 bg-transparent text-small text-text-secondary outline-none truncate"
          />
        </div>
        <button
          type="button"
          onClick={() => url && void copy(url)}
          disabled={!url}
          className="shrink-0 h-9 px-3 rounded-md border border-border-strong bg-surface-raised-2 hover:bg-surface-raised-3 text-small font-medium text-text-primary transition-colors disabled:opacity-40 cursor-pointer"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <p className="text-caption text-text-muted">
        Anyone with the link can request to join — you approve them from the
        members page.
      </p>
    </div>
  );
}

/** Split a comma/whitespace-separated string into unique trimmed emails. */
function parseEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * True when a failed invite is the Solo plan's member-limit gate.
 * `apiRequest` decodes both envelopes into `ApiError`: the nested
 * `{ error: { code, message } }` lands on `code`, while the flat
 * `{ error: "SOLO_MEMBER_LIMIT" }` (no sibling message) lands on
 * `message` — check both.
 */
function isSoloMemberLimit(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 402) return false;
  return err.code === "SOLO_MEMBER_LIMIT" || err.message === "SOLO_MEMBER_LIMIT";
}

/**
 * Add members to a workspace by email. Accepts one or more emails
 * (comma/space separated) and a role; each becomes a token-based
 * invitation the invitee picks up from their sidebar on next login —
 * no email is sent. Matches the Notion "Add members" layout.
 */
export function InviteDialog({
  workspaceSlug,
  open,
  onOpenChange,
  workspaceId,
  teams = [],
  onInvited,
}: Props) {
  const [emailsInput, setEmailsInput] = useState("");
  const [role, setRole] = useState<AssignableRole>("admin");
  const [roleOpen, setRoleOpen] = useState(false);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const selectedRole = ROLES.find((r) => r.value === role) ?? ROLES[0];

  function reset() {
    setEmailsInput("");
    setRole("admin");
    setRoleOpen(false);
    setTeamIds(new Set());
    setError(null);
    setSentCount(null);
    setSubmitting(false);
    setUpgradeOpen(false);
  }

  function toggleTeam(id: string) {
    setTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleInvite() {
    const emails = parseEmails(emailsInput);
    if (emails.length === 0) return;
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length > 0) {
      setError(`Not a valid email: ${invalid.join(", ")}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const results = await Promise.all(
        emails.map(async (email) => {
          try {
            await apiRequest<unknown>(
              `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
              {
                method: "POST",
                body: {
                  email,
                  role,
                  ...(teamIds.size > 0 ? { teamIds: [...teamIds] } : {}),
                },
              }
            );
            return { email, ok: true, soloBlocked: false };
          } catch (err) {
            return { email, ok: false, soloBlocked: isSoloMemberLimit(err) };
          }
        }),
      );
      const failed = results.filter((r) => !r.ok).map((r) => r.email);
      const succeeded = results.filter((r) => r.ok).map((r) => r.email);
      // Partial success: the successful invitations exist server-side, so
      // refresh the pending list before surfacing failures or the upgrade.
      if (succeeded.length > 0) onInvited?.(succeeded[0]);
      // Solo plan member gate → open the Team upgrade flow instead of a
      // raw error. The dialog keeps its state so the user can retry the
      // same invites after upgrading.
      if (results.some((r) => r.soloBlocked)) {
        setUpgradeOpen(true);
        return;
      }
      if (failed.length > 0) {
        setError(
          succeeded.length > 0
            ? `Invited ${succeeded.length}, but couldn't invite: ${failed.join(", ")}`
            : `Couldn't invite: ${failed.join(", ")}`
        );
        return;
      }
      setSentCount(emails.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <ModalShell
      open={open}
      onClose={() => {
        onOpenChange(false);
        reset();
      }}
      label="Add members"
      size="narrow"
    >
      <div className="p-6">
        <div className="flex flex-col items-center text-center gap-1.5">
          <h2 className="text-title font-medium text-text-primary">Add members</h2>
          <p className="text-body text-text-tertiary">
            Type or paste in emails below, separated by commas
          </p>
        </div>

        {sentCount != null ? (
          <div className="flex flex-col gap-2 py-4 text-center">
            <p className="text-body text-text-primary">
              {sentCount === 1 ? "Invitation sent." : `${sentCount} invitations sent.`}
            </p>
            <p className="text-small text-text-tertiary">
              They&apos;ll see it in their sidebar the next time they log in and
              can accept from there. Invites expire in 7 days.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 h-9 rounded-md bg-accent-primary text-accent-on text-body font-medium hover:bg-accent-primary/90 transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <SearchField
              value={emailsInput}
              onChange={setEmailsInput}
              placeholder="Search names or emails"
              autoFocus
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-small font-medium text-text-tertiary">Select role</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRoleOpen((o) => !o)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-surface-raised-2 border border-border-strong text-left hover:bg-surface-raised-3 transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-body font-medium text-text-primary">{selectedRole.label}</p>
                    <p className="text-small text-text-muted">{selectedRole.hint}</p>
                  </div>
                  <ChevronDown size={16} className="shrink-0 text-text-muted" />
                </button>

                {roleOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md overflow-hidden bg-bg-inset border border-border-strong shadow-[0_8px_32px_rgba(0,0,0,0.5)] py-1">
                    {ROLES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => {
                          setRole(r.value);
                          setRoleOpen(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 transition-colors cursor-pointer",
                          r.value === role ? "bg-surface-selected" : "hover:bg-surface-raised-2",
                        )}
                      >
                        <p className="text-body font-medium text-text-primary">{r.label}</p>
                        <p className="text-small text-text-muted">{r.hint}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <ShareLinkSection workspaceSlug={workspaceSlug} open={open} />

            {teams.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-small font-medium text-text-tertiary">
                  Add to teams (optional)
                </label>
                <ul className="rounded-md border border-border-strong divide-y divide-border-subtle overflow-hidden max-h-36 overflow-y-auto bg-surface-raised-1">
                  {teams.map((t) => {
                    const on = teamIds.has(t.id);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => toggleTeam(t.id)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-raised-2 transition-colors cursor-pointer"
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: t.color ?? "#8b5cf6" }}
                          />
                          <span className="flex-1 text-small text-text-primary truncate">
                            {t.name}
                          </span>
                          <span
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                              on
                                ? "bg-accent-primary border-accent-primary text-accent-on"
                                : "border-border-strong text-transparent"
                            )}
                          >
                            <Check size={10} strokeWidth={3} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {error && <p className="text-small text-danger">{error}</p>}

            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleInvite}
                disabled={submitting || emailsInput.trim() === ""}
                className="h-10 rounded-md bg-accent-primary text-accent-on text-body font-medium hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-md text-body font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised-2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalShell>

    {/* Solo member-limit gate — offers the in-place Team upgrade; the
        invite dialog stays behind with its emails intact for a retry. */}
    <UpgradeModal
      open={upgradeOpen}
      onOpenChange={setUpgradeOpen}
      workspaceId={workspaceId}
      variant="add-member"
    />
    </>
  );
}
