"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/lib/config";

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
    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-5 space-y-3">
      <h2 className="text-sm font-medium text-red-400">Danger Zone</h2>
      <p className="text-xs text-text-tertiary">
        Permanently delete your account and all associated data. This action
        cannot be undone.
      </p>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          className="px-4 py-2 text-sm rounded-lg border border-red-500/30 text-red-400
            hover:bg-red-500/10 transition-colors cursor-pointer"
        >
          Delete Account
        </button>
      ) : (
        <div className="space-y-3 rounded-lg bg-red-500/[0.05] border border-red-500/20 p-4">
          <p className="text-sm text-text-secondary">
            Are you sure? This will permanently delete your profile, API keys,
            canvas, and clusters. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConfirm(false)}
              disabled={deleting}
              className="px-4 py-2 text-sm rounded-lg border border-white/[0.1] text-text-secondary
                hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white
                hover:bg-red-500 transition-colors cursor-pointer disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Yes, delete my account"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
