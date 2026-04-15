import { Octokit } from "@octokit/rest";
import { LinkFollowResult } from "../types";

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
    } else if (parsed.type === "file") {
      return await extractFileContent(
        parsed.owner,
        parsed.repo,
        parsed.path!,
        url
      );
    }

    return null;
  } catch (error) {
    console.error(`Failed to extract GitHub content from ${url}:`, error);
    return null;
  }
}

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  type: "repo" | "file";
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
      return { owner, repo, type: "file", path, ref };
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

  // Get key config files
  const configFiles = [
    "package.json",
    "tsconfig.json",
    ".env.example",
    "docker-compose.yml",
    "docker-compose.yaml",
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
  url: string
): Promise<LinkFollowResult> {
  const file = await octokit.repos.getContent({
    owner,
    repo,
    path,
  });

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
