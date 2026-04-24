import { Octokit } from "@octokit/rest";
import { LinkFollowResult } from "../types";
import { logSystemEvent } from "@/features/analytics/server/system-events";

const GITHUB_TIMEOUT_MS = 15_000;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { timeout: GITHUB_TIMEOUT_MS },
});

export async function extractGitHubContent(
  url: string,
  depth: number
): Promise<LinkFollowResult | null> {
  try {
    const parsed = parseGitHubUrl(url);
    if (!parsed) return null;

    if (parsed.type === "repo") {
      return await extractRepoContent(parsed.owner, parsed.repo, url);
    } else if (parsed.type === "dir") {
      return await extractDirectoryContent(
        parsed.owner,
        parsed.repo,
        parsed.path!,
        parsed.ref,
        url
      );
    } else if (parsed.type === "file") {
      return await extractFileContent(
        parsed.owner,
        parsed.repo,
        parsed.path!,
        parsed.ref,
        url
      );
    }

    return null;
  } catch (error) {
    // Classify the error so the health dashboard can distinguish
    // rate-limits from 404s from genuine bugs. The user-facing
    // "unreachable" message still fires (pipeline.stepPlatformFetch
    // handles the null return), but this lets ops see WHY.
    const status = (error as { status?: number } | null)?.status;
    const message = error instanceof Error ? error.message : String(error);
    const rateLimitRemaining = (error as { response?: { headers?: Record<string, string> } } | null)
      ?.response?.headers?.["x-ratelimit-remaining"];

    let severity: "warn" | "error" = "error";
    let reason = "unknown";

    if (status === 403 && rateLimitRemaining === "0") {
      severity = "warn";
      reason = "rate_limit";
    } else if (status === 403) {
      severity = "warn";
      reason = "forbidden";
    } else if (status === 404) {
      severity = "warn";
      reason = "not_found";
    } else if (status && status >= 500) {
      severity = "warn";
      reason = "github_5xx";
    }

    console.error(`Failed to extract GitHub content from ${url} [${reason}, status=${status}]:`, error);
    void logSystemEvent({
      severity,
      category: "external_api",
      source: "github.extractGitHubContent",
      message: `GitHub fetch failed: ${reason} (${message})`,
      fingerprintKeys: ["github_extract", reason],
      metadata: { url, status, has_token: Boolean(process.env.GITHUB_TOKEN) },
    });
    return null;
  }
}

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  type: "repo" | "file" | "dir";
  path?: string;
  ref?: string;
}

function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  try {
    const urlObj = new URL(url);
    if (!urlObj.hostname.includes("github.com")) return null;

    const parts = urlObj.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1];

    if (parts.length > 3 && (parts[2] === "blob" || parts[2] === "tree")) {
      const ref = parts[3];
      const path = parts.slice(4).join("/");

      // `/tree/<ref>` with no sub-path is just the repo root at that ref.
      // The previous code routed this through extractFileContent with
      // path="", which made Octokit return a directory listing (array)
      // and blew up the `"content" in file.data` check. Route to the
      // repo extractor instead — it already handles root correctly.
      if (parts[2] === "tree" && path === "") {
        return { owner, repo, type: "repo", ref };
      }

      // `/tree/<ref>/some/sub/dir` points at a directory, not a file.
      const type = parts[2] === "tree" ? "dir" : "file";
      return { owner, repo, type, path, ref };
    }

    return { owner, repo, type: "repo" };
  } catch {
    return null;
  }
}

async function extractRepoContent(
  owner: string,
  repo: string,
  url: string
): Promise<LinkFollowResult> {
  const contentParts: string[] = [];
  const metadata: Record<string, unknown> = {};

  // Get repo info
  try {
    const repoInfo = await octokit.repos.get({ owner, repo });
    metadata.stars = repoInfo.data.stargazers_count;
    metadata.description = repoInfo.data.description;
    metadata.language = repoInfo.data.language;
    contentParts.push(`# ${repoInfo.data.full_name}`);
    contentParts.push(`\n${repoInfo.data.description || ""}\n`);
  } catch (err) {
    console.warn(`[github] Failed to get repo info for ${owner}/${repo}:`, err);
  }

  // Get README
  try {
    const readme = await octokit.repos.getReadme({ owner, repo });
    const readmeContent = Buffer.from(
      readme.data.content,
      "base64"
    ).toString("utf-8");
    contentParts.push("\n## README\n");
    contentParts.push(readmeContent.slice(0, 30_000)); // Cap README size
  } catch (err) {
    console.warn(`[github] No README for ${owner}/${repo}:`, err);
  }

  // AI-agent-oriented docs. These files tell a connected agent how to work
  // with the repo — far higher signal than generic README text for setup/tutorial
  // synthesis. Fetched with a 30K cap each (same as README).
  const agentDocFiles = [
    "CLAUDE.md",
    "AGENTS.md",
    "DESIGN.md",
  ];

  for (const filename of agentDocFiles) {
    try {
      const file = await octokit.repos.getContent({ owner, repo, path: filename });
      if ("content" in file.data && file.data.content) {
        const content = Buffer.from(file.data.content, "base64").toString("utf-8");
        contentParts.push(`\n## ${filename}\n${content.slice(0, 30_000)}\n`);
      }
    } catch {
      // File doesn't exist — expected for most repos
    }
  }

  // Get key config files
  const configFiles = [
    "package.json",
    "tsconfig.json",
    ".env.example",
    "docker-compose.yml",
    "docker-compose.yaml",
    "CONTRIBUTING.md",
    "DOCS_GUIDELINES.md",
  ];

  for (const filename of configFiles) {
    try {
      const file = await octokit.repos.getContent({
        owner,
        repo,
        path: filename,
      });
      if ("content" in file.data && file.data.content) {
        const content = Buffer.from(file.data.content, "base64").toString(
          "utf-8"
        );
        contentParts.push(
          `\n## ${filename}\n\`\`\`\n${content.slice(0, 10_000)}\n\`\`\`\n`
        );
      }
    } catch {
      // File doesn't exist — expected for many repos
    }
  }

  // Get file tree (top level only)
  try {
    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: "HEAD",
      recursive: "false",
    });
    const fileList = tree.data.tree
      .slice(0, 100) // Cap tree listing
      .map((item) => `${item.type === "tree" ? "d" : "f"} ${item.path}`)
      .join("\n");
    contentParts.push(`\n## File Structure\n\`\`\`\n${fileList}\n\`\`\`\n`);
    metadata.file_tree = fileList;
  } catch (err) {
    console.warn(`[github] Failed to get file tree for ${owner}/${repo}:`, err);
  }

  // Build thumbnail URL using our own OG image endpoint
  const params = new URLSearchParams({
    owner,
    repo,
    ...(metadata.description ? { desc: String(metadata.description).slice(0, 120) } : {}),
    ...(metadata.language ? { lang: String(metadata.language) } : {}),
    ...(metadata.file_tree ? { files: String(metadata.file_tree).slice(0, 1500) } : {}),
  });
  metadata.thumbnail_url = `/api/og/github?${params.toString()}`;

  return {
    url,
    type: "github_repo",
    content: contentParts.join("\n"),
    childLinks: [],
    metadata,
  };
}

async function extractFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string | undefined,
  url: string
): Promise<LinkFollowResult> {
  const file = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ...(ref ? { ref } : {}),
  });

  // Route around accidental directory requests: /blob/<ref>/some/dir
  // URLs occasionally reach this path even though blob normally means
  // file. If getContent returns an array, forward to the directory
  // handler instead of throwing.
  if (Array.isArray(file.data)) {
    return await extractDirectoryContent(owner, repo, path, ref, url);
  }

  if (!("content" in file.data) || !file.data.content) {
    throw new Error("Not a file");
  }

  const content = Buffer.from(file.data.content, "base64").toString("utf-8");

  return {
    url,
    type: "github_file",
    content: `# ${path}\n\n\`\`\`\n${content.slice(0, 30_000)}\n\`\`\``,
    childLinks: [],
    metadata: {
      path,
      size: file.data.size,
    },
  };
}

/**
 * Handle `/tree/<ref>/<sub/path>` URLs that point at a directory
 * (not the repo root — that's routed to extractRepoContent).
 *
 * Emits a listing of the directory plus any README found inside it.
 * Keeps the shape compatible with the rest of the pipeline by
 * returning a single LinkFollowResult.
 */
async function extractDirectoryContent(
  owner: string,
  repo: string,
  path: string,
  ref: string | undefined,
  url: string
): Promise<LinkFollowResult> {
  const contents = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ...(ref ? { ref } : {}),
  });

  if (!Array.isArray(contents.data)) {
    // getContent returned a single file — fall through to the file handler.
    if ("content" in contents.data && contents.data.content) {
      const content = Buffer.from(contents.data.content, "base64").toString("utf-8");
      return {
        url,
        type: "github_file",
        content: `# ${path}\n\n\`\`\`\n${content.slice(0, 30_000)}\n\`\`\``,
        childLinks: [],
        metadata: { path, size: contents.data.size },
      };
    }
    throw new Error("Unexpected content shape for directory path");
  }

  const parts: string[] = [`# ${owner}/${repo}/${path}`];
  const listing = contents.data
    .slice(0, 100)
    .map((item) => `${item.type === "dir" ? "d" : "f"} ${item.name}`)
    .join("\n");
  parts.push(`\n## Directory listing\n\`\`\`\n${listing}\n\`\`\`\n`);

  // Best-effort README pull from the sub-directory.
  const readmeEntry = contents.data.find(
    (item) => item.type === "file" && /^readme(\.md|\.rst|\.txt)?$/i.test(item.name)
  );
  if (readmeEntry) {
    try {
      const readme = await octokit.repos.getContent({
        owner,
        repo,
        path: readmeEntry.path,
        ...(ref ? { ref } : {}),
      });
      if (!Array.isArray(readme.data) && "content" in readme.data && readme.data.content) {
        const text = Buffer.from(readme.data.content, "base64").toString("utf-8");
        parts.push(`\n## ${readmeEntry.name}\n`);
        parts.push(text.slice(0, 30_000));
      }
    } catch (err) {
      console.warn(`[github] Failed to read ${readmeEntry.path} in ${owner}/${repo}:`, err);
    }
  }

  return {
    url,
    type: "github_repo",
    content: parts.join("\n"),
    childLinks: [],
    metadata: {
      path,
      entry_count: contents.data.length,
    },
  };
}
