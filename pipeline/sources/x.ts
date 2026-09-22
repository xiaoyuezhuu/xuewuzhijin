import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, fetchWithTimeout, hashId, log, warn } from "../util.ts";

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  public_metrics?: { like_count: number; retweet_count: number; reply_count: number };
}

interface SearchResponse {
  data?: Tweet[];
  includes?: { users?: { id: string; username: string; name: string }[] };
  errors?: { detail?: string; title?: string }[];
}

/**
 * X recent search. Requires an X API plan that includes
 * /2/tweets/search/recent (Basic and up); skipped when X_BEARER_TOKEN is unset.
 */
export async function collectX(
  config: SourcesConfig["x"],
  since: Date,
): Promise<RawItem[]> {
  if (!config.enabled || !config.queries.length) return [];

  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) {
    warn("x", "no X_BEARER_TOKEN set — skipping");
    return [];
  }

  const items: RawItem[] = [];
  for (const query of config.queries) {
    const url =
      "https://api.x.com/2/tweets/search/recent?" +
      new URLSearchParams({
        query,
        // The API rejects start_time older than 7 days on recent search.
        start_time: new Date(
          Math.max(since.getTime(), Date.now() - 6.5 * 86_400_000),
        ).toISOString(),
        max_results: String(Math.min(Math.max(config.maxResults, 10), 100)),
        "tweet.fields": "created_at,public_metrics,author_id",
        expansions: "author_id",
        "user.fields": "username,name",
      });
    try {
      const res = await fetchWithTimeout(url, {
        headers: { authorization: `Bearer ${bearer}` },
      });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status}${json.errors?.[0]?.detail ? ` — ${json.errors[0].detail}` : ""}`,
        );
      }
      const users = new Map(
        (json.includes?.users ?? []).map((u) => [u.id, u]),
      );
      for (const tweet of json.data ?? []) {
        const likes = tweet.public_metrics?.like_count ?? 0;
        if (likes < config.minLikes) continue;
        const user = users.get(tweet.author_id);
        const handle = user?.username ?? tweet.author_id;
        const target = `https://x.com/${handle}/status/${tweet.id}`;
        const canonicalUrl = canonicalizeUrl(target);
        items.push({
          id: hashId(canonicalUrl),
          // A tweet has no title; its first line stands in for one.
          title: tweet.text.split("\n")[0]!.slice(0, 160),
          url: target,
          canonicalUrl,
          source: user ? `@${handle}` : "X",
          kind: "x",
          publishedAt: new Date(tweet.created_at).toISOString(),
          author: user?.name ?? handle,
          summary: tweet.text,
          signals: {
            likes,
            reposts: tweet.public_metrics?.retweet_count,
            comments: tweet.public_metrics?.reply_count,
          },
        });
      }
    } catch (error) {
      warn("x", `"${query.slice(0, 40)}…": ${(error as Error).message}`);
    }
  }

  log("x", `${items.length} posts over ${config.minLikes} likes`);
  return items;
}
