import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, fetchWithTimeout, hashId, log, stripHtml, warn } from "../util.ts";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string;
  author: string | null;
  story_text: string | null;
}

export async function collectHn(
  config: SourcesConfig["hn"],
  since: Date,
): Promise<RawItem[]> {
  if (!config.enabled || !config.queries.length) return [];

  const sinceUnix = Math.floor(since.getTime() / 1000);
  const byId = new Map<string, RawItem>();

  for (const query of config.queries) {
    const url =
      "https://hn.algolia.com/api/v1/search?" +
      new URLSearchParams({
        query,
        tags: "story",
        numericFilters: `created_at_i>${sinceUnix},points>${config.minPoints}`,
        hitsPerPage: "20",
      });
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { hits } = (await res.json()) as { hits: AlgoliaHit[] };
      for (const hit of hits) {
        if (!hit.title) continue;
        const target = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const canonicalUrl = canonicalizeUrl(target);
        byId.set(canonicalUrl, {
          id: hashId(canonicalUrl),
          title: hit.title,
          url: target,
          canonicalUrl,
          source: "Hacker News",
          kind: "hn",
          publishedAt: new Date(hit.created_at).toISOString(),
          author: hit.author ?? undefined,
          summary: stripHtml(hit.story_text ?? "", 600),
          signals: {
            points: hit.points ?? undefined,
            comments: hit.num_comments ?? undefined,
          },
        });
      }
    } catch (error) {
      warn("hn", `"${query}": ${(error as Error).message}`);
    }
  }

  const items = [...byId.values()];
  log("hn", `${items.length} stories over ${config.minPoints} points`);
  return items;
}
