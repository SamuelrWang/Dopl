import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { supabaseAdmin as getAdmin } from "@/shared/supabase/admin";
import Link from "next/link";
import { DeleteAccount } from "./delete-account";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  // Get profile
  const { data: profile } = await getAdmin()
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <h1 className="text-xl font-medium text-text-primary mb-6">Settings</h1>

      <div className="rounded-xl bg-surface-raised-1 border border-border-default p-5 space-y-4">
        <div className="flex items-center gap-4">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="w-12 h-12 rounded-full border border-border-default"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-surface-raised-3 border border-border-default flex items-center justify-center text-text-secondary font-medium">
              {(profile?.display_name?.[0] || user.email?.[0] || "?").toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-text-primary">
              {profile?.display_name || "User"}
            </p>
            <p className="text-xs text-text-tertiary">{user.email}</p>
          </div>
        </div>

        <div className="border-t border-border-subtle pt-4 space-y-3">
          <Link
            href="/settings/profile"
            className="flex items-center justify-between text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <span>Profile</span>
            <span className="text-text-tertiary">&rarr;</span>
          </Link>
          <Link
            href="/settings/billing"
            className="flex items-center justify-between text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <span>Billing & Subscription</span>
            <span className="text-text-tertiary">&rarr;</span>
          </Link>
          <Link
            href="/settings/integrations"
            className="flex items-center justify-between text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <span>Integrations</span>
            <span className="text-text-tertiary">&rarr;</span>
          </Link>
        </div>
      </div>

      <DeleteAccount />
    </div>
  );
}
