"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";

export function DeleteAccount() {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rejecting keeps the ConfirmDialog open so the user can retry or cancel
  // (its onConfirm contract, which also expects the caller to toast) — the
  // same shape skill-view's permanent delete uses. Everything after the
  // account is actually gone is best-effort local cleanup and must not
  // re-open the dialog.
  async function handleDelete() {
    setError(null);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        // This route predates §9's `{ error: { code, message } }` envelope
        // and still answers with a flat `{ error: string }` on every failure
        // branch (src/app/api/user/delete/route.ts).
        const data = (await res
          .json()
          .catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Failed to delete account");
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong. Please try again.";
      setError(message);
      toast({ title: "Couldn't delete account", description: message });
      throw err;
    }

    try {
      // Clear all app-related localStorage before signing out
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith("dopl:onboarding:") ||
          key === "dopl:bookmarks" ||
          key === "dopl-sidebar-open"
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));

      // Sign out client-side and redirect
      await getSupabaseBrowser().auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      // localStorage may be unavailable, or sign-out may fail — the account
      // is already gone either way, so let the dialog close.
    }
  }

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-danger">
          Danger zone
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "space-y-3 p-4")}>
        <p className="text-caption text-text-secondary">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>

        {error && <p className="text-caption text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="btn-light rounded-md px-2.5 py-1.5 text-small font-medium text-danger"
        >
          Delete account
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete your account?"
        description="This permanently deletes your profile, API keys, and every workspace you own. This can't be undone."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={handleDelete}
      />
    </section>
  );
}
