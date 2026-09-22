import { createHash } from "node:crypto";

export const UA =
  "xuewuzhijin/0.1 (+personal reading curation; contact via repo owner)";

/** Tracking parameters that make identical URLs look different. */
const JUNK_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|s|cmpid|smid)/i;

export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input.trim());
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (JUNK_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return input.trim();
  }
}

export function hashId(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16);
}

/** Guards against malformed entities like &#99999999; blowing up the decode. */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Strips tags and entities from feed-supplied HTML, then clamps the length. */
export function stripHtml(html: string | undefined, maxChars = 1200): string {
  if (!html) return "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    // Numeric entities first (&#8217; and friends are everywhere in feeds),
    // then the named ones. &amp; is decoded last so "&amp;#39;" can't become
    // a quote via a second pass.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export function decodeEntities(s: string): string {
  return stripHtml(s, Number.MAX_SAFE_INTEGER);
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { "user-agent": UA, ...(rest.headers ?? {}) },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Serializes requests per hostname with a gap between them. Some publishers
 * (nature.com among them) serve a feed fine on its own but stonewall two or
 * three at once, which looks exactly like a dead feed. Global concurrency
 * still comes from mapLimit; this only spaces out same-host calls.
 */
const HOST_GAP_MS = 1_200;
const hostQueues = new Map<string, Promise<void>>();

export async function fetchPolitely(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return fetchWithTimeout(url, init);
  }

  const previous = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostQueues.set(host, previous.then(() => mine));

  await previous;
  try {
    return await fetchWithTimeout(url, init);
  } finally {
    // Hold the slot a moment longer so the next call to this host is spaced.
    setTimeout(release, HOST_GAP_MS);
  }
}

/** Runs tasks with bounded concurrency, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** ISO week slug, e.g. "2026-W38". */
export function isoWeekSlug(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current ISO week determines the year and week number.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function log(scope: string, message: string): void {
  console.log(`  ${scope.padEnd(10)} ${message}`);
}

export function warn(scope: string, message: string): void {
  console.warn(`  ${scope.padEnd(10)} ⚠ ${message}`);
}
