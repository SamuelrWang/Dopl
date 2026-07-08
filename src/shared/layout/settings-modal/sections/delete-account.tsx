"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/config";

export function DeleteAccount() {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete account");
        setDeleting(false);
        return;
      }

      // Clear all app-related localStorage before signing out
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (
            key.startsWith(CANVAS_STORAGE_KEY_PREFIX) ||
            key.startsWith("dopl:onboarding:") ||
            key === "dopl:bookmarks" ||
            key === "dopl-sidebar-open" ||
            key === CANVAS_ACTIVE_USER_KEY
          )) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch {
        // localStorage may not be available
      }

      // Sign out client-side and redirect
      await getSupabaseBrowser().auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setDeleting(false);
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

        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="btn-light rounded-md px-2.5 py-1.5 text-small font-medium text-danger"
          >
            Delete account
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-border-default bg-bg-elevated p-4">
            <p className="text-caption text-text-secondary">
              Are you sure? This will permanently delete your profile, API keys,
              canvas, and clusters. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={deleting}
                className="btn-light rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-danger px-2.5 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Yes, delete my account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
