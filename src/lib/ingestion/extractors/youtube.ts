import { LinkFollowResult } from "../types";
import { fetchWithTimeout } from "../utils";

export async function extractYouTubeTranscript(
  url: string,
  depth: number
): Promise<LinkFollowResult | null> {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) return null;

    const transcript = await fetchTranscript(videoId);

    return {
      url,
      type: "video",
      content:
        transcript || `[YouTube video: ${videoId} — transcript unavailable]`,
      childLinks: [],
      metadata: {
        videoId,
        platform: "youtube",
        hasTranscript: !!transcript,
      },
    };
  } catch (error) {
    console.error(`Failed to extract YouTube transcript from ${url}:`, error);
    return null;
  }
}

function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    if (urlObj.hostname.includes("youtube.com")) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1);
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    const pageResponse = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        timeoutMs: 15_000,
      }
    );

    const pageHtml = await pageResponse.text();

    const captionsMatch = pageHtml.match(
      /"captionTracks":\[.*?"baseUrl":"(.*?)"/
    );
    if (!captionsMatch) return null;

    const captionsUrl = captionsMatch[1].replace(/\\u0026/g, "&");

    const captionsResponse = await fetchWithTimeout(captionsUrl, {
      timeoutMs: 10_000,
    });
    const captionsXml = await captionsResponse.text();

    const textSegments = captionsXml.match(/<text[^>]*>(.*?)<\/text>/g) || [];
    const transcript = textSegments
      .map((segment) =>
        segment
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
      )
      .join(" ");

    return transcript || null;
  } catch {
    return null;
  }
}
