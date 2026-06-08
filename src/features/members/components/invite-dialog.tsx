"use client";

import { useState } from "react";
import { ChevronDown, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import type { AssignableRole } from "../types";

interface Props {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
 * Add members to a workspace by email. Accepts one or more emails
 * (comma/space separated) and a role; each becomes a token-based
 * invitation the invitee picks up from their sidebar on next login —
 * no email is sent. Matches the Notion "Add members" layout.
 */
export function InviteDialog({ workspaceSlug, open, onOpenChange, onInvited }: Props) {
  const [emailsInput, setEmailsInput] = useState("");
  const [role, setRole] = useState<AssignableRole>("admin");
  const [roleOpen, setRoleOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const selectedRole = ROLES.find((r) => r.value === role) ?? ROLES[0];

  function reset() {
    setEmailsInput("");
    setRole("admin");
    setRoleOpen(false);
    setError(null);
    setSentCount(null);
    setSubmitting(false);
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
          const res = await fetch(
            `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, role }),
            },
          );
          return { email, ok: res.ok };
        }),
      );
      const failed = results.filter((r) => !r.ok).map((r) => r.email);
      if (failed.length > 0) {
        setError(`Couldn't invite: ${failed.join(", ")}`);
        return;
      }
      setSentCount(emails.length);
      onInvited?.(emails[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md bg-modal-surface border-border-strong text-text-primary"
      >
        <div className="flex flex-col items-center text-center gap-1.5 pt-2">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-raised-3 border border-border-default text-text-secondary">
            <UserPlus size={18} />
          </div>
          <DialogTitle className="text-text-primary text-lg">Add members</DialogTitle>
          <p className="text-sm text-text-tertiary">
            Type or paste in emails below, separated by commas
          </p>
        </div>

        {sentCount != null ? (
          <div className="flex flex-col gap-2 py-4 text-center">
            <p className="text-sm text-text-primary">
              {sentCount === 1 ? "Invitation sent." : `${sentCount} invitations sent.`}
            </p>
            <p className="text-xs text-text-tertiary">
              They&apos;ll see it in their sidebar the next time they log in and
              can accept from there. Invites expire in 7 days.
            </p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 h-9 rounded-md bg-accent-primary text-accent-on text-sm font-medium hover:bg-accent-primary/90 transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <input
              type="text"
              value={emailsInput}
              onChange={(e) => setEmailsInput(e.target.value)}
              placeholder="Search names or emails"
              autoFocus
              className="h-10 px-3 rounded-md bg-surface-raised-2 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-tertiary">Select role</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRoleOpen((o) => !o)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-surface-raised-2 border border-border-strong text-left hover:bg-surface-raised-3 transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{selectedRole.label}</p>
                    <p className="text-xs text-text-muted">{selectedRole.hint}</p>
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
                        <p className="text-sm font-medium text-text-primary">{r.label}</p>
                        <p className="text-xs text-text-muted">{r.hint}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex flex-col gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleInvite}
                disabled={submitting || emailsInput.trim() === ""}
                className="h-10 rounded-md bg-accent-primary text-accent-on text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-10 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-raised-2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
