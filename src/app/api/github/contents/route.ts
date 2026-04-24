import { NextRequest, NextResponse } from "next/server";
import {
  parseGitHubUrl,
  getContents,
  getFileContent,
  getRepoMeta,
} from "@/shared/lib/github";
import { withExternalAuth } from "@/shared/auth/with-auth";

/**
 * GET /api/github/contents?repo=owner/repo&path=&type=dir|file&ref=
 *
 * Public endpoint for browsing GitHub repo files.
 * Uses server-side GITHUB_TOKEN for higher rate limits.
 */
async function handleGet(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const repoParam = searchParams.get("repo") || "";
  const path = searchParams.get("path") || "";
  const type = searchParams.get("type") || "dir";
  const ref = searchParams.get("ref") || undefined;

  // Parse repo from URL or owner/repo format
  let owner: string;
  let repo: string;

  if (repoParam.includes("github.com")) {
    const parsed = parseGitHubUrl(repoParam);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
    }
    owner = parsed.owner;
    repo = parsed.repo;
  } else {
    const parts = repoParam.split("/");
    if (parts.length !== 2) {
      return NextResponse.json(
        { error: "Repo must be in owner/repo format" },
        { status: 400 }
      );
    }
    owner = parts[0];
    repo = parts[1];
  }

  const token = process.env.GITHUB_TOKEN || null;

  try {
    if (type === "file") {
      const content = await getFileContent(owner, repo, path, token, ref);
      if (!content) {
        return NextResponse.json(
          { error: "File not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(content);
    }

    // Directory listing
    const entries = await getContents(owner, repo, path, token, ref);
    if (!entries) {
      return NextResponse.json(
        { error: "Directory not found" },
        { status: 404 }
      );
    }

    // Include repo meta for root directory requests
    let meta = null;
    if (!path) {
      meta = await getRepoMeta(owner, repo, token);
    }

    return NextResponse.json({ entries, meta });
  } catch (error) {
    console.error("[github] Contents fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch GitHub contents" },
      { status: 500 }
    );
  }
}

export const GET = withExternalAuth(handleGet);
