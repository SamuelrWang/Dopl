"use client";

/**
 * PublishedEntryCard — simplified entry panel for the published canvas.
 * Shows title, summary, and source URL. No artifact viewer or downloads.
 */

interface PublishedEntryCardProps {
  title: string | null;
  summary: string | null;
  sourceUrl: string | null;
}

const platformFromUrl = (url: string | null): string => {
  if (!url) return "web";
  if (url.includes("github.com")) return "github";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("twitter.com") || url.includes("x.com")) return "x";
  if (url.includes("reddit.com")) return "reddit";
  if (url.includes("instagram.com")) return "instagram";
  return "web";
};

const platformColors: Record<string, string> = {
  github: "from-neutral-800 to-neutral-900",
  youtube: "from-red-900/60 to-red-950/60",
  x: "from-neutral-900 to-black",
  reddit: "from-orange-900/40 to-red-950/40",
  instagram: "from-fuchsia-900/40 via-pink-900/40 to-orange-900/40",
  web: "from-slate-900/60 to-black",
};

const platformLabels: Record<string, string> = {
  github: "GitHub",
  youtube: "YouTube",
  x: "X",
  reddit: "Reddit",
  instagram: "Instagram",
  web: "Web",
};

export function PublishedEntryCard({
  title,
  summary,
  sourceUrl,
}: PublishedEntryCardProps) {
  const platform = platformFromUrl(sourceUrl);
  const gradient = platformColors[platform] || platformColors.web;

  return (
    <div className="w-full h-full rounded-xl border border-white/[0.08] bg-[#111111] overflow-hidden flex flex-col shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
      {/* Thumbnail area */}
      <div
        className={`h-32 bg-gradient-to-br ${gradient} relative flex-shrink-0`}
      >
        <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-black/50 text-white/70 backdrop-blur-sm border border-white/[0.08]">
          {platformLabels[platform]}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col gap-2 overflow-hidden">
        <h3 className="text-white text-sm font-medium leading-snug line-clamp-2">
          {title || "Untitled Entry"}
        </h3>
        {summary && (
          <p className="text-white/40 text-xs leading-relaxed line-clamp-6 flex-1">
            {summary}
          </p>
        )}
        {sourceUrl && (
          <div className="mt-auto pt-2 border-t border-white/[0.06]">
            <span className="text-[11px] text-white/25 truncate block">
              {sourceUrl.replace(/^https?:\/\//, "").split("/").slice(0, 2).join("/")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
