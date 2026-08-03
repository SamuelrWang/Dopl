"use client";

import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "w-5 h-5 text-micro rounded",
  md: "w-7 h-7 text-caption rounded-md",
  lg: "w-9 h-9 text-body rounded-lg",
};

interface Props {
  name: string;
  iconUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}

/**
 * Workspace avatar — renders the uploaded icon image when one is set,
 * otherwise a generated letter mark (first character of the name). Used
 * by the sidebar brand slot, the switcher trigger, the dropdown header,
 * and each workspace row so every surface stays in sync.
 */
export function WorkspaceAvatar({ name, iconUrl, size = "md", className }: Props) {
  const letter = (name.trim()[0] || "?").toUpperCase();
  // Workspace icons are Supabase-storage objects, which the packaged CSP
  // already names — so this is a passthrough today. It rides the same resolver
  // as member avatars so a future icon host does not silently render blank.
  const src = useBridgedImageSrc(iconUrl);
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center justify-center overflow-hidden border border-border-default bg-surface-raised-3 text-text-secondary font-medium",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        letter
      )}
    </span>
  );
}
