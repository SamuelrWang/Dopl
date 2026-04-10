/**
 * GitHub API utilities for the public file browser.
 * Uses GITHUB_TOKEN for higher rate limits, but works without it for public repos.
 */

export interface GitHubFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
  sha: string;
}

export interface GitHubFileContent {
  name: string;
  path: string;
  size: number;
  content: string;
}

export function parseGitHubUrl(
  url: string
): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

async function githubFetch(
  endpoint: string,
  token?: string | null
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`https://api.github.com${endpoint}`, {
    headers,
    next: { revalidate: 120 },
  });
}

export async function getContents(
  owner: string,
  repo: string,
  path: string = "",
  token?: string | null,
  ref?: string
): Promise<GitHubFileEntry[] | null> {
  const cleanPath = path === "/" || path === "" ? "" : `/${path}`;
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(
    `/repos/${owner}/${repo}/contents${cleanPath}${refQuery}`,
    token
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data)) return null;

  const entries: GitHubFileEntry[] = data.map(
    (item: Record<string, unknown>) => ({
      name: item.name as string,
      path: item.path as string,
      type: item.type as "file" | "dir",
      size: item.size as number,
      sha: item.sha as string,
    })
  );

  // Sort: directories first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  token?: string | null,
  ref?: string
): Promise<GitHubFileContent | null> {
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(
    `/repos/${owner}/${repo}/contents/${path}${refQuery}`,
    token
  );
  if (!res.ok) return null;
  const data = await res.json();

  if (data.type !== "file" || data.content == null) return null;

  let content: string;
  try {
    content = Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    content = "";
  }

  return {
    name: data.name,
    path: data.path,
    size: data.size,
    content,
  };
}

export async function getRepoMeta(
  owner: string,
  repo: string,
  token?: string | null
) {
  const res = await githubFetch(`/repos/${owner}/${repo}`, token);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    default_branch: data.default_branch as string,
    description: data.description as string | null,
    stargazers_count: data.stargazers_count as number,
    forks_count: data.forks_count as number,
    language: data.language as string | null,
    size: data.size as number,
  };
}
