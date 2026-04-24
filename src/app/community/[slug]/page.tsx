/**
 * Server component for `/community/<slug>`. Fetches the published
 * cluster once, emits rich Open Graph / Twitter Card metadata (so X
 * comments unfurl with a preview card), and hands the snapshot to
 * `CommunityDetailClient` to render — avoiding the "fetch on mount
 * with spinner" round-trip the old client-only page had.
 *
 * The Dopl viral flow is: publish cluster → paste URL under viral
 * post → viewer clicks. The OG tags here determine the card that
 * appears in the X / Slack / Discord preview — without them, every
 * cluster shows the generic site card.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedClusterCached } from "@/features/community/server/get-published-cluster-cached";
import CommunityDetailClient from "./community-detail-client";

// Keep crawlers (X, Slack, Discord) from hammering the DB on every
// link-preview request. 60s is fine for viral-post timing — the first
// crawl fills the cache, subsequent crawls hit it.
export const revalidate = 60;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  let cluster;
  try {
    cluster = await getPublishedClusterCached(slug);
  } catch {
    // Missing row — return generic metadata so the 404 page still gets
    // reasonable social preview behavior.
    return {
      title: "Cluster not found · Dopl",
    };
  }

  // `getPublishedCluster` doesn't filter by status (it's also used by
  // the owner-editing flow), so enforce public visibility here. Matches
  // the check the legacy /api/community/[slug] route performed —
  // without this, archived / draft clusters would leak via the URL.
  if (cluster.status !== "published") {
    return {
      title: "Cluster not found · Dopl",
    };
  }

  const title = `${cluster.title} · Dopl`;
  const rawDescription = cluster.description?.trim() || "";
  const description =
    rawDescription.length > 0
      ? rawDescription.slice(0, 200)
      : `${cluster.panel_count} AI & automation setup${cluster.panel_count === 1 ? "" : "s"} from ${cluster.author.display_name || "Anonymous"} on Dopl.`;

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://usedopl.com";
  const pageUrl = `${siteUrl}/community/${slug}`;

  // Note: NO explicit `images` key here. The colocated
  // `opengraph-image.tsx` file is a Next.js metadata convention — it
  // auto-populates `og:image` and `twitter:image` with a dynamically
  // rendered card that includes the real panel layout. Manual images
  // here would override that file and break the richer OG card.
  return {
    title,
    description,
    openGraph: {
      type: "article",
      siteName: "Dopl",
      title,
      description,
      url: pageUrl,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: cluster.author.twitter_handle
        ? `@${cluster.author.twitter_handle.replace(/^@/, "")}`
        : undefined,
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

export default async function CommunityDetailPage({ params }: PageProps) {
  const { slug } = await params;

  let cluster;
  try {
    cluster = await getPublishedClusterCached(slug);
  } catch {
    notFound();
  }

  // Same public-visibility guard as generateMetadata — do not render
  // non-published rows. `getPublishedCluster` itself is status-agnostic
  // because it's also reused by admin / owner tooling.
  if (cluster.status !== "published") {
    notFound();
  }

  return <CommunityDetailClient cluster={cluster} />;
}
