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
import type { Invitation } from "../types";

interface Props {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (invitation: Invitation) => void;
}

const ROLES: Array<{ value: "admin" | "editor" | "viewer"; label: string; hint: string }> = [
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
  { value: "editor", label: "Editor", hint: "Can edit clusters, brain, and chats" },
  { value: "admin", label: "Admin", hint: "Editor + invite + workspace settings" },
];

/**
 * Invite a new member to a workspace. Sends a POST that mints a token,
 * then surfaces the magic-link URL so the inviter can paste it into
 * email/Slack/etc until automated email send lands.
 */
export function InviteMemberDialog({
  workspaceSlug,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setRole("editor");
    setError(null);
    setLinkUrl(null);
    setCopied(false);
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
      const { invitation } = (await res.json()) as { invitation: Invitation };
      const url = `${window.location.origin}/invite/${invitation.token}`;
      setLinkUrl(url);
      onCreated?.(invitation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable on http origins; fall back to
      // letting the user select the text manually.
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
            Send the magic link to your invitee. Until automated email is
            wired, copy the link and share it manually.
          </DialogDescription>
        </DialogHeader>

        {linkUrl ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-white/60">
              Invitation created. Share this link with{" "}
              <span className="text-white">{email.trim()}</span>:
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={linkUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-xs text-white outline-none font-mono"
              />
              <button
                type="button"
                onClick={copyLink}
                className="h-9 px-3 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors shrink-0"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[10px] uppercase tracking-wider text-white/30">
              Link expires in 7 days
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
          {linkUrl ? (
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
                {submitting ? "Creating..." : "Create invite"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
