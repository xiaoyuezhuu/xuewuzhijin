import type { RssSource } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, hashId, log, mapLimit, warn } from "../util.ts";
import { fetchFeed } from "./feed.ts";

export async function collectRss(
  sources: RssSource[],
  since: Date,
): Promise<RawItem[]> {
  const perFeed = await mapLimit(sources, 6, async (source) => {
    try {
      const entries = await fetchFeed(source.url);
      const items: RawItem[] = [];
      for (const entry of entries) {
        const published = entry.publishedAt ? new Date(entry.publishedAt) : null;
        // Feeds without dates are treated as fresh; the model sees "date unknown".
        if (published && !Number.isNaN(published.valueOf()) && published < since) continue;
        const canonicalUrl = canonicalizeUrl(entry.url);
        items.push({
          id: hashId(canonicalUrl),
          title: entry.title,
          url: entry.url,
          canonicalUrl,
          source: source.name,
          kind: "rss",
          publishedAt:
            published && !Number.isNaN(published.valueOf())
              ? published.toISOString()
              : new Date().toISOString(),
          author: entry.author,
          summary: entry.summary,
          topicHints: source.topics,
        });
      }
      return items;
    } catch (error) {
      warn("rss", `${source.name}: ${(error as Error).message} — ${source.url}`);
      return [];
    }
  });

  const items = perFeed.flat();
  log("rss", `${items.length} items from ${sources.length} feeds`);
  return items;
}
