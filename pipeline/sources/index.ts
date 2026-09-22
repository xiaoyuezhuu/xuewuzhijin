import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { collectArxiv } from "./arxiv.ts";
import { collectHn } from "./hn.ts";
import { collectReddit } from "./reddit.ts";
import { collectRss } from "./rss.ts";
import { collectX } from "./x.ts";
import { collectYoutube } from "./youtube.ts";

/**
 * Runs every adapter. Adapters never throw: a dead feed or a missing
 * credential degrades to a warning and an empty list, so one bad source can't
 * take down the day's curation.
 */
export async function collectAll(
  config: SourcesConfig,
  since: Date,
): Promise<RawItem[]> {
  const batches = await Promise.all([
    collectRss(config.rss, since),
    collectHn(config.hn, since),
    collectArxiv(config.arxiv, since),
    collectReddit(config.reddit, since),
    collectYoutube(config.youtube, since),
    collectX(config.x, since),
  ]);
  return batches.flat();
}
