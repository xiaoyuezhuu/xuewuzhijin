import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, hashId, log, mapLimit, warn } from "../util.ts";
import { fetchFeed } from "./feed.ts";

/** Per-channel Atom feeds — no API key, no quota. */
export async function collectYoutube(
  config: SourcesConfig["youtube"],
  since: Date,
): Promise<RawItem[]> {
  if (!config.enabled || !config.channels.length) return [];

  const perChannel = await mapLimit(config.channels, 4, async (channel) => {
    try {
      const entries = await fetchFeed(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`,
      );
      const items: RawItem[] = [];
      for (const entry of entries) {
        const published = entry.publishedAt ? new Date(entry.publishedAt) : null;
        if (published && published < since) continue;
        const canonicalUrl = canonicalizeUrl(entry.url);
        items.push({
          id: hashId(canonicalUrl),
          title: entry.title,
          url: entry.url,
          canonicalUrl,
          source: channel.name,
          kind: "youtube",
          publishedAt: (published ?? new Date()).toISOString(),
          author: entry.author ?? channel.name,
          summary: entry.summary,
          topicHints: channel.topics,
        });
      }
      return items;
    } catch (error) {
      warn("youtube", `${channel.name}: ${(error as Error).message}`);
      return [];
    }
  });

  const items = perChannel.flat();
  log("youtube", `${items.length} videos from ${config.channels.length} channels`);
  return items;
}
