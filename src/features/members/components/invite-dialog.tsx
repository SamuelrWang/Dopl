"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { AssignableRole } from "../types";

interface Props {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful invite so the parent can refresh lists. */
  onInvited?: (email: string) => void;
}

const ROLES: Array<{ value: AssignableRole; label: string; hint: string }> = [
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
  { value: "member", label: "Member", hint: "Use everything: KBs, skills, canvas" },
  { value: "admin", label: "Admin", hint: "Full access, manage members + workspace" },
];

/**
 * Invite a new member to a workspace by email. The invitee picks up
 * the invite via the sidebar dropdown when they next log in (matched
 * by email) — no link copy or email send is needed. Dialog confirms
 * "Invitation sent" on success and closes.
 */
export function InviteDialog({ workspaceSlug, open, onOpenChange, onInvited }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setRole("member");
    setError(null);
    setSentTo(null);
    setSubmitting(false);
  }

  async function handleInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, role }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to invite");
      }
      setSentTo(trimmed);
      onInvited?.(trimmed);
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
      <DialogContent className="sm:max-w-md bg-[#0a0a0a] border-white/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Invite to workspace</DialogTitle>
          <DialogDescription className="text-white/50">
            They'll see the invite in their sidebar the next time they log in.
          </DialogDescription>
        </DialogHeader>

        {sentTo ? (
          <div className="flex flex-col gap-2 py-4">
            <p className="text-sm text-white">
              Invitation sent to <span className="text-white">{sentTo}</span>.
            </p>
            <p className="text-xs text-white/50">
              They'll see it in their sidebar dropdown the next time they log in
              and can accept from there. The invite expires in 7 days.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                autoFocus
                className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
                Role
              </label>
              <div className="flex flex-col gap-1">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    className={`flex items-center justify-between px-3 py-2 rounded-md border text-left transition-colors ${
                      role === r.value
                        ? "bg-white/[0.08] border-white/[0.25] text-white"
                        : "bg-white/[0.03] border-white/[0.1] text-white/70 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="text-[11px] text-white/40">{r.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}

        <DialogFooter className="bg-transparent border-white/[0.08]">
          {sentTo ? (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-8 px-4 rounded-md text-xs font-medium text-white/60 hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInvite}
                disabled={submitting || !email.trim()}
                className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Sending..." : "Send invite"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
