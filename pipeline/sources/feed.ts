import { XMLParser } from "fast-xml-parser";
import { decodeEntities, fetchPolitely, stripHtml } from "../util.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

export interface FeedEntry {
  title: string;
  url: string;
  publishedAt?: string;
  author?: string;
  summary?: string;
}

/**
 * Bluesky and Mastodon items carry only a description — a post has no title.
 * Stand one in from the opening of the text so the item survives, and so the
 * headline on the page reads like the post rather than an empty string.
 */
function titleFrom(summary: string): string {
  const firstLine = summary.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  const source = firstLine.length >= 20 ? firstLine : summary.trim();
  return source.length > 150 ? `${source.slice(0, 150).trimEnd()}…` : source;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("#text" in obj) return text(obj["#text"]);
    if ("@_href" in obj) return String(obj["@_href"]);
  }
  return "";
}

/** Atom entries carry several <link>s; the alternate/self one is the article. */
function atomLink(entry: Record<string, unknown>): string {
  const links = asArray(entry.link as unknown);
  for (const link of links) {
    if (typeof link === "object" && link !== null) {
      const obj = link as Record<string, unknown>;
      const rel = obj["@_rel"];
      if (rel === undefined || rel === "alternate") return String(obj["@_href"] ?? "");
    }
  }
  return links.length ? text(links[0]) : "";
}

/** Parses RSS 2.0, RDF, and Atom into one shape. */
export function parseFeed(xml: string): FeedEntry[] {
  const doc = parser.parse(xml) as Record<string, any>;

  const rssItems = asArray(doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item);
  if (rssItems.length) {
    return rssItems.map((item: Record<string, unknown>) => {
      const summary = stripHtml(
        text((item as any)["content:encoded"]) || text(item.description),
      );
      return {
        title: decodeEntities(text(item.title)) || titleFrom(summary),
        url: text(item.link) || text((item as any).guid),
        publishedAt: text(item.pubDate) || text((item as any)["dc:date"]) || undefined,
        author:
          decodeEntities(text((item as any)["dc:creator"]) || text(item.author)) ||
          undefined,
        summary,
      };
    });
  }

  const atomEntries = asArray(doc?.feed?.entry);
  return atomEntries.map((entry: Record<string, any>) => {
    const summary = stripHtml(
      text(entry.content) ||
        text(entry.summary) ||
        text(entry["media:group"]?.["media:description"]),
    );
    return {
      title: decodeEntities(text(entry.title)) || titleFrom(summary),
      url: atomLink(entry) || text(entry.id),
      publishedAt: text(entry.published) || text(entry.updated) || undefined,
      // arXiv and other Atom feeds list every author; the first few are enough.
      author:
        asArray(entry.author)
          .map((a: any) => decodeEntities(text(a?.name)))
          .filter(Boolean)
          .slice(0, 3)
          .join(", ") || undefined,
      summary,
    };
  });
}

const ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

async function fetchOnce(url: string): Promise<FeedEntry[]> {
  const res = await fetchPolitely(url, { headers: { accept: ACCEPT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const entries = parseFeed(await res.text()).filter((e) => e.title && e.url);
  // An empty result is reported, not returned silently: for the checker it is
  // the finding, and for a run it means the feed contributed nothing.
  if (!entries.length) throw new Error("no usable entries parsed");
  return entries;
}

/**
 * One retry after a long pause. Throttled publishers (nature.com is the
 * reliable offender) answer a burst with an HTML interstitial that parses to
 * nothing, then serve the real feed once things quieten down. Twenty seconds
 * is what it actually takes to clear; shorter waits still came back empty.
 */
export async function fetchFeed(url: string): Promise<FeedEntry[]> {
  try {
    return await fetchOnce(url);
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    try {
      return await fetchOnce(url);
    } catch (second) {
      throw new Error(
        `${(first as Error).message} (retry: ${(second as Error).message})`,
      );
    }
  }
}
