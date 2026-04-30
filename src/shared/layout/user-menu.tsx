"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import type { User } from "@supabase/supabase-js";

type UserMenuProps = {
  dropdownDirection?: "down" | "up";
};

export function UserMenu({ dropdownDirection = "down" }: UserMenuProps = {}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const supabase = getSupabaseBrowser();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, session: { user: User } | null) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  // Close menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!user) return null;

  const initials = getInitials(user);
  const avatarUrl = user.user_metadata?.avatar_url;

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium
          border border-white/[0.1] bg-white/[0.06] hover:bg-white/[0.1]
          transition-colors cursor-pointer overflow-hidden"
        aria-label="User menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-text-secondary">{initials}</span>
        )}
      </button>

      {open && (
        <div
          className={
            dropdownDirection === "up"
              ? "absolute left-0 bottom-full mb-2 w-48 rounded-lg overflow-hidden bg-[oklch(0.16_0_0)] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
              : "absolute right-0 top-full mt-2 w-48 rounded-lg overflow-hidden bg-[oklch(0.16_0_0)] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          }
        >
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <p className="text-xs text-text-secondary truncate">{user.email}</p>
          </div>

          <div className="py-1">
            <MenuButton
              onClick={() => {
                setOpen(false);
                router.push("/settings/billing");
              }}
            >
              Billing
            </MenuButton>
            <MenuButton
              onClick={() => {
                setOpen(false);
                router.push("/settings");
              }}
            >
              Settings
            </MenuButton>
            <MenuButton
              onClick={() => {
                setOpen(false);
                router.push("/settings/keys");
              }}
            >
              API Keys
            </MenuButton>
            <MenuButton onClick={handleSignOut}>Sign out</MenuButton>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-sm text-text-secondary
        hover:bg-white/[0.06] hover:text-text-primary transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

function getInitials(user: User): string {
  const name =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "";
  const parts = name.split(/[\s@]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (name[0] || "?").toUpperCase();
}
