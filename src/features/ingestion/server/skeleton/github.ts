import "server-only";
import { Octokit } from "@octokit/rest";

const GITHUB_TIMEOUT_MS = 15_000;

// Anonymous GitHub API access is limited to 60 req/hr, which a mass
// skeleton ingest run will exhaust in under a minute. Surface the
// missing-token case at module load so ops catches it before a batch.
if (!process.env.GITHUB_TOKEN) {
  console.warn(
    "[skeleton] GITHUB_TOKEN is not set — Octokit will use anonymous 60/hr limit, " +
      "which WILL rate-limit any non-trivial mass ingest."
  );
}

export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { timeout: GITHUB_TIMEOUT_MS },
});

export interface GitHubFacts {
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  license: string | null;
  pushedAt: string | null;
  headSha: string | null;
  topics: string[];
  readmeExcerpt: string;
  fileTree: string;
  topLevelFiles: string[];
  topLevelDirs: string[];
  defaultBranch: string;
}

export function parseRepoUrl(
  url: string
): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

/**
 * Fetch the per-repo facts the skeleton pipeline needs: metadata,
 * truncated README, shallow file tree, licence, and default branch.
 *
 * Returns `null` only when the URL itself isn't a parseable GitHub repo
 * URL or the repo has been deleted / is private (404). Rate-limit and
 * 5xx responses from the GitHub API throw — the pipeline surfaces those
 * to ops rather than masquerading them as "not a GitHub URL".
 *
 * README and tree fetches are treated as non-fatal — a descriptor is
 * still useful without them.
 */
export async function gatherGitHubFacts(url: string): Promise<GitHubFacts | null> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return null; // genuinely not a repo URL
  const { owner, repo } = parsed;

  // repos.get failure is NOT the same as a parse failure — a 403 rate-
  // limit or 5xx here means GitHub is unhappy, and the pipeline should
  // surface that to ops rather than telling the user "not a GitHub URL."
  // README and tree fetches below stay non-fatal; only repos.get is
  // treated as required.
  let repoInfo;
  try {
    repoInfo = await octokit.repos.get({ owner, repo });
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    const rateLimitRemaining = (err as { response?: { headers?: Record<string, string> } } | null)
      ?.response?.headers?.["x-ratelimit-remaining"];
    if (status === 404) return null; // repo was deleted / private — treat as not-ingestable
    const reason =
      status === 403 && rateLimitRemaining === "0"
        ? "GitHub rate limit exhausted"
        : status === 403
          ? "GitHub access forbidden"
          : status && status >= 500
            ? `GitHub server error (${status})`
            : `GitHub API error (${status ?? "unknown"})`;
    throw new Error(`${reason} for ${owner}/${repo}`);
  }

  const description = repoInfo.data.description ?? null;
  const language = repoInfo.data.language ?? null;
  const stars = repoInfo.data.stargazers_count ?? 0;
  const license = repoInfo.data.license?.spdx_id ?? null;
  const pushedAt = repoInfo.data.pushed_at ?? null;
  const defaultBranch = repoInfo.data.default_branch ?? "HEAD";
  const topics = Array.isArray(repoInfo.data.topics) ? repoInfo.data.topics : [];

  let readmeExcerpt = "";
  try {
    const readme = await octokit.repos.getReadme({ owner, repo });
    readmeExcerpt = Buffer.from(readme.data.content, "base64")
      .toString("utf-8")
      .slice(0, 8_000); // plenty for descriptor generation
  } catch {
    // many repos have no README — acceptable at skeleton tier
  }

  let fileTree = "";
  let headSha: string | null = null;
  let topLevelFiles: string[] = [];
  let topLevelDirs: string[] = [];
  try {
    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: "false",
    });
    headSha = tree.data.sha ?? null;
    const items = tree.data.tree.slice(0, 60);
    fileTree = items
      .map((item) => `${item.type === "tree" ? "d" : "f"} ${item.path}`)
      .join("\n");
    topLevelFiles = items
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => item.path as string);
    topLevelDirs = items
      .filter((item) => item.type === "tree" && typeof item.path === "string")
      .map((item) => item.path as string);
  } catch {
    // Non-fatal — descriptor still useful without the tree
  }

  return {
    owner,
    repo,
    description,
    language,
    stars,
    license,
    pushedAt,
    headSha,
    topics,
    readmeExcerpt,
    fileTree,
    topLevelFiles,
    topLevelDirs,
    defaultBranch,
  };
}
