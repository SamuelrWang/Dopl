"use client";

import { apiErrorFrom } from "@/shared/api/api-envelope";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { toast } from "@/shared/ui/toast";
import { SettingsPanel, SettingsRow, SettingsRows } from "./settings-panel";

export function DeleteAccount() {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ConfirmDialog `onConfirm` contract: rejecting keeps the dialog open for
  // retry/cancel, and the caller toasts. ⚠ Everything after the account is
  // actually gone is best-effort cleanup and must NOT re-open the dialog.
  async function handleDelete() {
    setError(null);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        // ⚠ Predates §9's `{ error: { code, message } }` envelope — answers a
        // flat `{ error: string }` on every failure branch
        // (src/app/api/user/delete/route.ts).
        throw apiErrorFrom(res.status, await res.json().catch(() => null));
      }
    } catch (err) {
      const message = userFacingMessage(err);
      setError(message);
      toast({ title: "Couldn't delete account", description: message });
      throw err;
    }

    try {
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

      await getSupabaseBrowser().auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      // localStorage unavailable or sign-out failed — account is gone either
      // way, so let the dialog close.
    }
  }

  return (
    <SettingsPanel id="settings-account-danger" label="Danger zone">
      <SettingsRows label="Danger zone">
        <SettingsRow
          title="Delete account"
          meta={error ? <span className="text-danger">{error}</span> : undefined}
        >
          <OpenScaleButton onClick={() => setConfirmOpen(true)} className="text-danger">
            Delete
          </OpenScaleButton>
        </SettingsRow>
      </SettingsRows>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete your account?"
        description="This permanently deletes your profile, API keys, and every workspace you own. This can't be undone."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={handleDelete}
      />
    </SettingsPanel>
  );
}
