"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface ProfileData {
  display_name: string | null;
  bio: string | null;
  website_url: string | null;
  twitter_handle: string | null;
  github_username: string | null;
}

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<ProfileData>({
    display_name: "",
    bio: "",
    website_url: "",
    twitter_handle: "",
    github_username: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => {
        if (!r.ok) throw new Error("Not authenticated");
        return r.json();
      })
      .then((data) => {
        setProfile({
          display_name: data.display_name || "",
          bio: data.bio || "",
          website_url: data.website_url || "",
          twitter_handle: data.twitter_handle || "",
          github_username: data.github_username || "",
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-surface-raised-3 rounded" />
          <div className="h-40 bg-surface-raised-3 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-tertiary transition-colors mb-4"
      >
        <ArrowLeft size={12} /> Settings
      </Link>

      <h1 className="text-xl font-medium text-text-primary mb-6">Profile</h1>

      <div className="rounded-xl bg-surface-raised-1 border border-border-default p-5 space-y-5">
        {/* Display Name */}
        <Field
          label="Display Name"
          value={profile.display_name || ""}
          onChange={(v) => setProfile((p) => ({ ...p, display_name: v }))}
          placeholder="Your name"
        />

        {/* Bio */}
        <div>
          <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
            Bio
          </label>
          <textarea
            value={profile.bio || ""}
            onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
            placeholder="Tell people about yourself..."
            rows={3}
            className="w-full px-3 py-2 rounded-md bg-surface-raised-2 border border-border-default text-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-border-strong transition-colors resize-none"
          />
        </div>

        {/* Website */}
        <Field
          label="Website"
          value={profile.website_url || ""}
          onChange={(v) => setProfile((p) => ({ ...p, website_url: v }))}
          placeholder="https://example.com"
        />

        {/* Twitter */}
        <Field
          label="Twitter / X"
          value={profile.twitter_handle || ""}
          onChange={(v) => setProfile((p) => ({ ...p, twitter_handle: v }))}
          placeholder="username (without @)"
        />

        {/* GitHub */}
        <Field
          label="GitHub"
          value={profile.github_username || ""}
          onChange={(v) => setProfile((p) => ({ ...p, github_username: v }))}
          placeholder="username"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex items-center gap-3 pt-2 border-t border-border-subtle">
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-9 px-5 rounded-md bg-surface-cta text-text-on-cta text-sm font-medium hover:bg-surface-cta/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 rounded-md bg-surface-raised-2 border border-border-default text-sm text-text-primary placeholder:text-text-disabled outline-none focus:border-border-strong transition-colors"
      />
    </div>
  );
}
