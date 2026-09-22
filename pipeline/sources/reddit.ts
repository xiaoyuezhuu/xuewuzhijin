import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, fetchWithTimeout, hashId, log, stripHtml, warn } from "../util.ts";

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    author: string;
    selftext: string;
    is_self: boolean;
    stickied: boolean;
    over_18: boolean;
  };
}

async function getToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  const res = await fetchWithTimeout("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": process.env.REDDIT_USER_AGENT ?? "xuewuzhijin/0.1",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token request returned HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export async function collectReddit(
  config: SourcesConfig["reddit"],
  since: Date,
): Promise<RawItem[]> {
  if (!config.enabled || !config.subreddits.length) return [];

  let token: string | null;
  try {
    token = await getToken();
  } catch (error) {
    warn("reddit", `auth failed: ${(error as Error).message}`);
    return [];
  }
  if (!token) {
    warn("reddit", "no REDDIT_CLIENT_ID/SECRET set — skipping");
    return [];
  }

  const items: RawItem[] = [];
  for (const subreddit of config.subreddits) {
    try {
      const res = await fetchWithTimeout(
        `https://oauth.reddit.com/r/${subreddit}/top?t=day&limit=25`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            "user-agent": process.env.REDDIT_USER_AGENT ?? "xuewuzhijin/0.1",
          },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: { children: RedditPost[] } };
      for (const { data } of json.data.children) {
        if (data.stickied || data.over_18) continue;
        if (data.score < config.minScore) continue;
        const published = new Date(data.created_utc * 1000);
        if (published < since) continue;
        // For link posts the outbound URL is the artifact; for text posts the
        // discussion itself is.
        const target = data.is_self
          ? `https://www.reddit.com${data.permalink}`
          : data.url;
        const canonicalUrl = canonicalizeUrl(target);
        items.push({
          id: hashId(canonicalUrl),
          title: data.title,
          url: target,
          canonicalUrl,
          source: `r/${subreddit}`,
          kind: "reddit",
          publishedAt: published.toISOString(),
          author: data.author,
          summary: stripHtml(data.selftext, 800),
          signals: { points: data.score, comments: data.num_comments },
        });
      }
    } catch (error) {
      warn("reddit", `r/${subreddit}: ${(error as Error).message}`);
    }
  }

  log("reddit", `${items.length} posts over ${config.minScore} points`);
  return items;
}
