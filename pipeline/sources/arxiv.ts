import type { SourcesConfig } from "../config.ts";
import type { RawItem } from "../types.ts";
import { canonicalizeUrl, fetchWithTimeout, hashId, log, stripHtml, warn } from "../util.ts";
import { parseFeed } from "./feed.ts";

/** arXiv asks for a few seconds between API calls. */
const POLITE_DELAY_MS = 3_000;

export async function collectArxiv(
  config: SourcesConfig["arxiv"],
  since: Date,
): Promise<RawItem[]> {
  if (!config.enabled || !config.categories.length) return [];

  const keywords = (config.keywords ?? []).map((k) => k.toLowerCase());
  const items: RawItem[] = [];

  for (const [index, category] of config.categories.entries()) {
    if (index > 0) await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    const url =
      "https://export.arxiv.org/api/query?" +
      new URLSearchParams({
        search_query: `cat:${category}`,
        sortBy: "submittedDate",
        sortOrder: "descending",
        max_results: String(config.maxPerCategory * 3),
      });
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = parseFeed(await res.text());
      let kept = 0;
      for (const entry of entries) {
        if (kept >= config.maxPerCategory) break;
        const published = entry.publishedAt ? new Date(entry.publishedAt) : null;
        if (published && published < since) continue;
        const haystack = `${entry.title} ${entry.summary ?? ""}`.toLowerCase();
        if (keywords.length && !keywords.some((k) => haystack.includes(k))) continue;
        // Link to the abstract page, not the PDF.
        const target = entry.url.replace("/pdf/", "/abs/");
        const canonicalUrl = canonicalizeUrl(target);
        items.push({
          id: hashId(canonicalUrl),
          title: entry.title.replace(/\s+/g, " "),
          url: target,
          canonicalUrl,
          source: `arXiv ${category}`,
          kind: "arxiv",
          publishedAt: (published ?? new Date()).toISOString(),
          author: entry.author,
          summary: stripHtml(entry.summary, 1400),
        });
        kept++;
      }
    } catch (error) {
      warn("arxiv", `${category}: ${(error as Error).message}`);
    }
  }

  log("arxiv", `${items.length} preprints across ${config.categories.length} categories`);
  return items;
}
