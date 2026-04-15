/**
 * GET /api/og/github — server-rendered GitHub repo preview card.
 *
 * Used as the `thumbnail_url` for GitHub repos. Renders a visual showing
 * the repo name, description, language, and file tree — so the card
 * thumbnail looks like "the files" rather than a generic placeholder.
 *
 * Query params:
 *  - owner:  repo owner
 *  - repo:   repo name
 *  - desc:   repo description (optional)
 *  - lang:   primary language (optional)
 *  - files:  newline-separated file list, prefixed with "d " or "f " (optional)
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

const langColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  PHP: "#4F5D95",
  Shell: "#89e051",
  Dart: "#00B4AB",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const owner = (searchParams.get("owner") || "").slice(0, 40);
  const repo = (searchParams.get("repo") || "").slice(0, 60);
  const desc = (searchParams.get("desc") || "").slice(0, 120);
  const lang = (searchParams.get("lang") || "").slice(0, 30);
  const filesRaw = (searchParams.get("files") || "").slice(0, 1500);

  const files = filesRaw
    .split("\n")
    .filter(Boolean)
    .slice(0, 16);

  const langColor = langColors[lang] || "rgba(255,255,255,0.5)";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#0b0b0b",
          backgroundImage:
            "radial-gradient(circle at 30% 20%, #101010 0%, #0b0b0b 50%, #050505 100%)",
          padding: "48px 56px",
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

        {/* Header — GitHub icon + repo name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 12,
          }}
        >
          {/* GitHub octocat silhouette as a simple circle icon */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 22,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            &#9679;
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 14,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              }}
            >
              {owner}
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "rgba(255,255,255,0.95)",
                lineHeight: 1.1,
              }}
            >
              {repo}
            </div>
          </div>

          {/* Language badge */}
          {lang && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginLeft: "auto",
                padding: "4px 12px",
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: langColor,
                }}
              />
              <div
                style={{
                  fontSize: 14,
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                }}
              >
                {lang}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        {desc && (
          <div
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.4,
              marginBottom: 20,
              marginLeft: 60,
            }}
          >
            {desc}
          </div>
        )}

        {/* File tree */}
        {files.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginLeft: 60,
              padding: "16px 20px",
              borderRadius: 8,
              backgroundColor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            {files.map((file, i) => {
              const isDir = file.startsWith("d ");
              const name = file.replace(/^[df] /, "");
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "4px 0",
                    borderBottom:
                      i < files.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      color: isDir
                        ? "rgba(130,180,255,0.8)"
                        : "rgba(255,255,255,0.35)",
                      width: 16,
                      textAlign: "center",
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                    }}
                  >
                    {isDir ? "▸" : " "}
                  </div>
                  <div
                    style={{
                      fontSize: 15,
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                      color: isDir
                        ? "rgba(130,180,255,0.9)"
                        : "rgba(255,255,255,0.75)",
                      fontWeight: isDir ? 600 : 400,
                    }}
                  >
                    {name}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 14,
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            color: "rgba(255,255,255,0.25)",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginTop: 16,
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
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
}
