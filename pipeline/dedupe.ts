import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";
import type { CuratedItem, RawItem } from "./types.ts";
import { canonicalizeUrl, hashId, log } from "./util.ts";

const SEEN_PATH = path.join(DATA_DIR, "state", "seen.json");

interface SeenStore {
  /** id -> ISO date it was published on the site. */
  ids: Record<string, string>;
  /** Normalized title -> ISO date, to catch the same story at a second URL. */
  titles: Record<string, string>;
}

/** Aggressive title normalization — this is a dedupe key, not a display value. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|of|for|to|and|on|in|is|are|how|why|what)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

export function loadSeen(): SeenStore {
  if (!fs.existsSync(SEEN_PATH)) return { ids: {}, titles: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_PATH, "utf8")) as Partial<SeenStore>;
    return { ids: parsed.ids ?? {}, titles: parsed.titles ?? {} };
  } catch {
    return { ids: {}, titles: {} };
  }
}

export function recordSeen(items: CuratedItem[], date: string): void {
  const seen = loadSeen();

  // Drop any earlier record of this date first: a re-run replaces the
  // edition, so the store should describe what is actually published, not
  // the union of every attempt.
  for (const map of [seen.ids, seen.titles]) {
    for (const [key, value] of Object.entries(map)) {
      if (value === date) delete map[key];
    }
  }

  for (const item of items) {
    seen.ids[hashId(canonicalizeUrl(item.url))] = date;
    seen.titles[titleKey(item.title)] = date;
  }
  // Keep the store from growing without bound: 180 days is far longer than
  // anything could plausibly resurface as "today's".
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  for (const map of [seen.ids, seen.titles]) {
    for (const [key, value] of Object.entries(map)) {
      if (value < cutoff) delete map[key];
    }
  }
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, `${JSON.stringify(seen, null, 2)}\n`);
}

/**
 * Collapses duplicates inside one batch, then drops anything already
 * published. Within a batch, the item with the richer summary wins, so an
 * arXiv abstract beats the same paper's bare Reddit link post.
 */
export function dedupe(items: RawItem[], forDate?: string): RawItem[] {
  const seen = loadSeen();

  // Entries recorded for the date being built come from an earlier run of the
  // same edition, which this run replaces. Without this, re-running a day
  // suppresses its own best picks and publishes the runners-up.
  if (forDate) {
    for (const map of [seen.ids, seen.titles]) {
      for (const [key, value] of Object.entries(map)) {
        if (value === forDate) delete map[key];
      }
    }
  }

  const byUrl = new Map<string, RawItem>();

  for (const item of items) {
    const existing = byUrl.get(item.canonicalUrl);
    if (!existing) {
      byUrl.set(item.canonicalUrl, item);
      continue;
    }
    const merged = (item.summary?.length ?? 0) > (existing.summary?.length ?? 0)
      ? { ...item }
      : { ...existing };
    // Engagement numbers are worth keeping whichever copy carried them.
    merged.signals = { ...existing.signals, ...item.signals };
    byUrl.set(item.canonicalUrl, merged);
  }

  const byTitle = new Map<string, RawItem>();
  for (const item of byUrl.values()) {
    const key = titleKey(item.title);
    if (!key) {
      byTitle.set(item.canonicalUrl, item);
      continue;
    }
    const existing = byTitle.get(key);
    if (!existing || (item.summary?.length ?? 0) > (existing.summary?.length ?? 0)) {
      byTitle.set(key, item);
    }
  }

  const fresh = [...byTitle.values()].filter(
    (item) => !seen.ids[item.id] && !seen.titles[titleKey(item.title)],
  );

  log(
    "dedupe",
    `${items.length} → ${fresh.length} (${items.length - byTitle.size} duplicate, ` +
      `${byTitle.size - fresh.length} already published)`,
  );
  return fresh;
}
