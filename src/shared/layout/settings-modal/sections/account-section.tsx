"use client";

import { useEffect, useState } from "react";
import { DeleteAccount } from "@/app/settings/delete-account";
import { SectionShell } from "./section-shell";

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

/**
 * Account section — edit display name, view the signed-in email/avatar,
 * and the danger-zone account deletion. Backed by `/api/user/profile`.
 */
export function AccountSection() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProfileData | null) => {
        if (cancelled || !data) return;
        setProfile(data);
        setDisplayName(data.display_name ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = profile != null && displayName.trim() !== (profile.display_name ?? "");

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to save");
      }
      const updated = (await res.json()) as ProfileData;
      setProfile(updated);
      setStatus("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionShell title="Account" subtitle="Manage your personal account">
      <div className="flex items-center gap-4">
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar_url}
            alt=""
            className="w-14 h-14 rounded-full border border-white/[0.1] object-cover"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-lg text-white/70">
            {(displayName[0] || profile?.email?.[0] || "?").toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {profile?.display_name || "User"}
          </p>
          <p className="text-xs text-white/40 truncate">{profile?.email}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {status && <p className="text-xs text-emerald-400">{status}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={handleSave}
          className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <DeleteAccount />
    </SectionShell>
  );
}
