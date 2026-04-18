/**
 * Dynamic Open Graph image for `/community/<slug>`.
 *
 * Next.js colocated-metadata convention: the presence of this file
 * auto-populates `og:image` + `twitter:image` on the page. The URL
 * becomes `/community/<slug>/opengraph-image`, with the extension
 * appended per Next's route handlers.
 *
 * The card renders a richly-detailed "mini-canvas" — each panel drawn
 * at its actual relative x/y with its own entry thumbnail, title, and
 * platform label — plus a text band with cluster title, author, and
 * Dopl branding. This looks like a real screenshot of the cluster
 * canvas (entry thumbnails are real remote images, not schematics).
 *
 * Runtime: Node. We need the full Node runtime because the data
 * loader (`getPublishedCluster`) transitively imports modules that
 * rely on Node APIs like `process.cwd` (via Supabase admin / the
 * AI client stack). Edge is not viable here and the ISR cache
 * (`revalidate = 60`) makes the cold-start difference negligible —
 * every request after the first hits a cached PNG anyway.
 */

import { ImageResponse } from "next/og";
import { getPublishedClusterCached } from "@/lib/community/get-published-cluster-cached";
import type { PublishedClusterDetail } from "@/lib/community/types";

export const runtime = "nodejs";
export const revalidate = 60;

export const alt = "Dopl cluster preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ── Card geometry ────────────────────────────────────────────────────

const CARD_W = size.width;
const CARD_H = size.height;
const PADDING = 48;
const TEXT_BAND_H = 170; // bottom band for title / author / branding
const MINI_W = CARD_W - PADDING * 2;
const MINI_H = CARD_H - TEXT_BAND_H - PADDING * 2;

// Max scale for panels — never blow up tiny clusters so big that single
// panels dominate the card. 0.35 keeps text-sized elements visually
// "panel-shaped" at this resolution.
const MAX_PANEL_SCALE = 0.35;

// ── Entry-point component ────────────────────────────────────────────

export default async function ClusterOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let cluster: PublishedClusterDetail | null = null;
  try {
    cluster = await getPublishedClusterCached(slug);
  } catch {
    // Missing row — fall through to branded "Cluster not found" card.
  }

  // Non-published (archived / draft) should not leak via the OG image
  // either — match the page's visibility guard.
  if (!cluster || cluster.status !== "published") {
    return new ImageResponse(<NotFoundCard />, size);
  }

  return new ImageResponse(<ClusterCard cluster={cluster} />, size);
}

// ── Card variants ────────────────────────────────────────────────────

function ClusterCard({ cluster }: { cluster: PublishedClusterDetail }) {
  // Join panels with their entry data so we can render thumbnails.
  const entriesById = new Map(cluster.entries.map((e) => [e.entry_id, e]));
  const enrichedPanels = cluster.panels
    .map((p) => ({ panel: p, entry: entriesById.get(p.entry_id) }))
    .filter(
      (pair): pair is { panel: (typeof cluster.panels)[number]; entry: (typeof cluster.entries)[number] } =>
        Boolean(pair.entry)
    );

  // Compute layout for the mini-canvas area.
  const layout = computeMiniCanvasLayout(enrichedPanels.map((p) => p.panel));

  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        display: "flex",
        flexDirection: "column",
        background: "#0c0c0c",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        position: "relative",
      }}
    >
      {/* Subtle grid pattern overlay for the canvas-y feel. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* ── Mini-canvas (top ~75% of card) ── */}
      <div
        style={{
          display: "flex",
          position: "relative",
          width: MINI_W,
          height: MINI_H,
          marginLeft: PADDING,
          marginTop: PADDING,
        }}
      >
        {enrichedPanels.length === 0 ? (
          <EmptyMiniCanvas />
        ) : (
          enrichedPanels.map(({ panel, entry }) => {
            const left =
              (panel.x - layout.bounds.minX) * layout.scale + layout.offsetX;
            const top =
              (panel.y - layout.bounds.minY) * layout.scale + layout.offsetY;
            const w = Math.max(panel.width * layout.scale, 80);
            const h = Math.max(panel.height * layout.scale, 60);
            return (
              <MiniPanel
                key={panel.id}
                left={left}
                top={top}
                width={w}
                height={h}
                thumbnail={entry.thumbnail_url}
                title={entry.title || panel.title || "Untitled"}
                platform={entry.source_platform}
              />
            );
          })
        )}
      </div>

      {/* ── Text band (bottom ~25%) ── */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          width: CARD_W - PADDING * 2,
          height: TEXT_BAND_H,
          marginLeft: PADDING,
          marginBottom: PADDING,
          marginTop: "auto",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: CARD_W - PADDING * 2 - 180, // room for DOPL wordmark
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 600,
              lineHeight: 1.1,
              color: "#fff",
              // Limit to 2 lines via text-overflow — Satori supports it.
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {cluster.title}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 12,
              fontSize: 20,
              color: "rgba(255,255,255,0.55)",
              gap: 12,
            }}
          >
            <span>by {cluster.author.display_name || "Anonymous"}</span>
            <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
            <span>
              {cluster.panel_count}{" "}
              {cluster.panel_count === 1 ? "entry" : "entries"}
            </span>
            {cluster.category && (
              <>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>·</span>
                <span style={{ textTransform: "capitalize" }}>
                  {cluster.category}
                </span>
              </>
            )}
          </div>
        </div>

        <DoplWordmark />
      </div>
    </div>
  );
}

function MiniPanel({
  left,
  top,
  width,
  height,
  thumbnail,
  title,
  platform,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  thumbnail: string | null;
  title: string;
  platform: string | null;
}) {
  // Thumbnail occupies top ~55% of the panel (matches the real card).
  const thumbH = Math.floor(height * 0.55);

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        display: "flex",
        flexDirection: "column",
        background: "#0d0d0d",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          width={width}
          height={thumbH}
          style={{
            width,
            height: thumbH,
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width,
            height: thumbH,
            background:
              "linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.15)",
            fontSize: Math.floor(height * 0.18),
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          {(platform || "web").toUpperCase()}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: Math.max(4, Math.floor(width * 0.04)),
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: Math.max(9, Math.floor(height * 0.08)),
            lineHeight: 1.2,
            color: "rgba(255,255,255,0.9)",
            fontWeight: 500,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </div>
        {platform && (
          <div
            style={{
              fontSize: Math.max(7, Math.floor(height * 0.05)),
              color: "rgba(255,255,255,0.35)",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 2,
            }}
          >
            {platform}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyMiniCanvas() {
  return (
    <div
      style={{
        display: "flex",
        width: MINI_W,
        height: MINI_H,
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.2)",
        fontSize: 28,
        border: "1px dashed rgba(255,255,255,0.08)",
        borderRadius: 16,
      }}
    >
      Empty cluster
    </div>
  );
}

function DoplWordmark() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: -1,
        }}
      >
        Dopl
      </span>
      <span
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.3)",
          textTransform: "uppercase",
          letterSpacing: 2,
        }}
      >
        dopl.ai
      </span>
    </div>
  );
}

function NotFoundCard() {
  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0c0c0c",
        color: "rgba(255,255,255,0.5)",
        fontSize: 42,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      Cluster not found · Dopl
    </div>
  );
}

// ── Layout math ──────────────────────────────────────────────────────

/**
 * Compute a uniform scale + offset so every panel's bounding box fits
 * inside the mini-canvas area (MINI_W × MINI_H) with breathing room.
 */
function computeMiniCanvasLayout(
  panels: { x: number; y: number; width: number; height: number }[]
): {
  scale: number;
  offsetX: number;
  offsetY: number;
  bounds: { minX: number; minY: number; width: number; height: number };
} {
  if (panels.length === 0) {
    return {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      bounds: { minX: 0, minY: 0, width: 0, height: 0 },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  }

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  // 10% margin on each side so panels don't touch the mini-canvas edge.
  const MARGIN = 0.9;
  const scaleX = (MINI_W * MARGIN) / width;
  const scaleY = (MINI_H * MARGIN) / height;
  const scale = Math.min(scaleX, scaleY, MAX_PANEL_SCALE);

  const scaledW = width * scale;
  const scaledH = height * scale;
  const offsetX = (MINI_W - scaledW) / 2;
  const offsetY = (MINI_H - scaledH) / 2;

  return {
    scale,
    offsetX,
    offsetY,
    bounds: { minX, minY, width, height },
  };
}
