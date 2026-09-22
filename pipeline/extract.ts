import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { RawItem } from "./types.ts";
import { fetchWithTimeout, log, mapLimit } from "./util.ts";

export interface Extracted {
  text: string;
  words: number;
}

/** Kinds where fetching the page adds nothing over what the adapter gave us. */
const NO_FETCH = new Set(["youtube", "x", "arxiv"]);

/**
 * A VirtualConsole with no listeners attached. jsdom's default forwards CSS
 * parse errors to the real console, and a single publisher's stylesheet can
 * bury an entire run's log in minified CSS.
 */
const quietConsole = new VirtualConsole();

const MAX_BYTES = 2_500_000;
const MAX_CHARS = 14_000;

async function extractOne(item: RawItem): Promise<Extracted | null> {
  if (NO_FETCH.has(item.kind)) return null;
  try {
    const res = await fetchWithTimeout(item.url, { timeoutMs: 25_000 });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return null;
    const html = new TextDecoder("utf-8").decode(buffer);

    const dom = new JSDOM(html, { url: res.url, virtualConsole: quietConsole });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();
    if (!article?.textContent) return null;

    const text = article.textContent.replace(/\s+/g, " ").trim();
    if (text.length < 400) return null; // paywall stub or a redirect interstitial

    return {
      text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text,
      words: text.split(/\s+/).length,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches readable text for the triage survivors, so the final pass judges the
 * actual writing rather than the headline. Failures are silent and expected —
 * paywalls, JS-only pages, and PDFs all land here.
 */
export async function extractAll(items: RawItem[]): Promise<Map<string, Extracted>> {
  const results = await mapLimit(items, 5, (item) => extractOne(item));
  const map = new Map<string, Extracted>();
  results.forEach((result, index) => {
    if (result) map.set(items[index]!.id, result);
  });
  log("extract", `full text for ${map.size}/${items.length} finalists`);
  return map;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 230));
}
