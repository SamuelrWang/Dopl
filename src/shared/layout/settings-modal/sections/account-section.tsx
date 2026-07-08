"use client";

import { useEffect, useState } from "react";
import { DeleteAccount } from "./delete-account";
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
            className="h-14 w-14 rounded-full border border-border-default object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-inset text-title text-text-secondary">
            {(displayName[0] || profile?.email?.[0] || "?").toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">
            {profile?.display_name || "User"}
          </p>
          <p className="truncate text-caption text-text-muted">{profile?.email}</p>
        </div>
      </div>

      <label className="flex max-w-sm flex-col gap-1">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Display name
        </span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="concave-field rounded-lg px-2.5 py-1.5 text-body text-text-primary outline-none"
        />
      </label>

      {error && <p className="text-caption text-danger">{error}</p>}
      {status && <p className="text-caption text-success">{status}</p>}

      <div className="flex max-w-sm justify-end">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={handleSave}
          className="flex h-7 cursor-pointer items-center rounded-md bg-surface-cta px-2.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <DeleteAccount />
    </SectionShell>
  );
}
