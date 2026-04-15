/**
 * GET /api/og/tweet — server-rendered tweet preview card.
 *
 * Used as the `thumbnail_url` for X posts that have no embedded media (no
 * photos, no video, no article cover). Instead of falling back to the user's
 * avatar or a bare platform-letter placeholder, we render the tweet itself
 * as an image using `next/og`'s `ImageResponse`. The thumbnail literally
 * becomes "the post".
 *
 * Query params:
 *  - text:   tweet text (trimmed to keep URL manageable)
 *  - author: display name
 *  - handle: screen_name (without @)
 *
 * Visual language matches the rest of the app:
 *  - Dark liquid-glass background
 *  - Top specular highlight
 *  - Mono @handle, medium author name, large tweet text
 *  - 1200x630 aspect (standard OG image size, scales cleanly into aspect-video)
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const text = (searchParams.get("text") || "").slice(0, 320);
  const author = (searchParams.get("author") || "").slice(0, 80);
  const handle = (searchParams.get("handle") || "").slice(0, 40);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          // Dark base matching the app's canvas background
          backgroundColor: "#0b0b0b",
          backgroundImage:
            "radial-gradient(circle at 30% 20%, #101010 0%, #0b0b0b 50%, #050505 100%)",
          padding: 72,
          position: "relative",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        {/* Top specular highlight */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
          }}
        />

        {/* Header row — X logo + author */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 40,
          }}
        >
          {/* Minimal X glyph */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 34,
              fontWeight: 700,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            𝕏
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 32,
                fontWeight: 600,
                color: "rgba(255,255,255,0.95)",
                lineHeight: 1.1,
              }}
            >
              {author || "X Post"}
            </div>
            {handle && (
              <div
                style={{
                  fontSize: 22,
                  color: "rgba(255,255,255,0.45)",
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  marginTop: 4,
                }}
              >
                @{handle}
              </div>
            )}
          </div>
        </div>

        {/* Tweet body */}
        <div
          style={{
            display: "flex",
            fontSize: 44,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.92)",
            fontWeight: 400,
            flex: 1,
            // Clamp visually — ImageResponse doesn't support line-clamp, but
            // we cap input at 320 chars which comfortably fits in the frame.
          }}
        >
          {text || "Tweet"}
        </div>

        {/* Bottom mono footer — matches MonoLabel tone */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 18,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            color: "rgba(255,255,255,0.35)",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginTop: 32,
          }}
        >
          Dopl
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // Long cache — the content is derived entirely from query params, so
        // identical params always produce the same image.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
}
