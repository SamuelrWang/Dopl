import { cn } from "@/shared/lib/utils";

type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "w-5 h-5 text-[10px] rounded",
  md: "w-7 h-7 text-xs rounded-md",
  lg: "w-9 h-9 text-sm rounded-lg",
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
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center justify-center overflow-hidden border border-white/[0.1] bg-white/[0.06] text-text-secondary font-medium",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        letter
      )}
    </span>
  );
}
