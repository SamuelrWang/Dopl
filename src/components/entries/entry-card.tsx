"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface EntryCardProps {
  id: string;
  title: string | null;
  summary: string | null;
  sourceUrl: string;
  sourcePlatform: string | null;
  thumbnailUrl: string | null;
  useCase: string | null;
  complexity: string | null;
  status: string;
  createdAt: string;
}

const complexityColors: Record<string, string> = {
  simple: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  moderate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  complex: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  advanced: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  github: "GitHub",
  youtube: "YT",
  web: "Web",
};

const platformColors: Record<string, string> = {
  x: "bg-black text-white",
  instagram: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
  github: "bg-gray-800 text-white",
  youtube: "bg-red-600 text-white",
  web: "bg-blue-600 text-white",
};

const placeholderGradients: Record<string, string> = {
  x: "from-gray-800 to-gray-900",
  instagram: "from-purple-600 via-pink-500 to-orange-400",
  github: "from-gray-700 to-gray-800",
  youtube: "from-red-700 to-red-900",
  web: "from-blue-700 to-blue-900",
};

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30
      ? u.pathname.slice(0, 27) + "..."
      : u.pathname;
    return u.hostname.replace("www.", "") + path;
  } catch {
    return url.slice(0, 50);
  }
}

export function EntryCard({
  id,
  title,
  summary,
  sourceUrl,
  sourcePlatform,
  thumbnailUrl,
  useCase,
  complexity,
  status,
  createdAt,
}: EntryCardProps) {
  const platform = sourcePlatform || "web";
  const gradientClass = placeholderGradients[platform] || placeholderGradients.web;

  function handleDownload(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.open(`/api/entries/${id}/download?file=agents_md`, "_blank");
  }

  function handleSourceClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.open(sourceUrl, "_blank", "noopener");
  }

  return (
    <Link href={`/entries/${id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full overflow-hidden group">
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title || "Post thumbnail"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              loading="lazy"
              onError={(e) => {
                // Fall back to gradient on image load error
                const target = e.currentTarget;
                target.style.display = "none";
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className={`w-full h-full bg-gradient-to-br ${gradientClass} flex items-center justify-center ${thumbnailUrl ? "hidden" : ""}`}
          >
            <span className="text-3xl font-bold text-white/30">
              {platformLabels[platform] || "SIE"}
            </span>
          </div>

          {/* Platform badge */}
          <div className="absolute top-2 left-2">
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${platformColors[platform] || platformColors.web}`}
            >
              {platformLabels[platform] || "Web"}
            </span>
          </div>

          {/* Status badge if not complete */}
          {status !== "complete" && (
            <div className="absolute top-2 right-2">
              <Badge variant={status === "error" ? "destructive" : "secondary"}>
                {status}
              </Badge>
            </div>
          )}
        </div>

        <CardContent className="p-3 space-y-2">
          {/* Title */}
          <h3 className="font-medium text-sm line-clamp-2 leading-tight">
            {title || "Untitled"}
          </h3>

          {/* Source URL */}
          <button
            onClick={handleSourceClick}
            className="text-xs text-muted-foreground hover:text-foreground truncate block w-full text-left"
            title={sourceUrl}
          >
            {truncateUrl(sourceUrl)}
          </button>

          {/* Badges + download */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {complexity && (
              <Badge className={`text-[10px] px-1.5 py-0 ${complexityColors[complexity] || ""}`}>
                {complexity}
              </Badge>
            )}
            {useCase && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {useCase.replace(/_/g, " ")}
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto">
              {new Date(createdAt).toLocaleDateString()}
            </span>
          </div>

          {/* Download button */}
          {status === "complete" && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleDownload}
            >
              Download agents.md
            </Button>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
