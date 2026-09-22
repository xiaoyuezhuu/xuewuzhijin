export const TOPICS = [
  "AI",
  "AGI",
  "Alignment",
  "Economics",
  "Geopolitics",
  "FutureTech",
  "Neuroscience",
  "SynBio",
  "Design",
] as const;

export type Topic = (typeof TOPICS)[number];

/**
 * Topics collapse into four colour families on the site: technology is blue,
 * life sciences green, money and power orange, and design a neutral violet.
 */
export type TopicFamily = "tech" | "bio" | "econ" | "design";

export const TOPIC_FAMILY: Record<Topic, TopicFamily> = {
  AI: "tech",
  AGI: "tech",
  Alignment: "tech",
  FutureTech: "tech",
  Neuroscience: "bio",
  SynBio: "bio",
  Economics: "econ",
  Geopolitics: "econ",
  Design: "design",
};

export type SourceKind = "rss" | "hn" | "arxiv" | "reddit" | "youtube" | "x";

/** One candidate as it comes off a source adapter. */
export interface RawItem {
  /** Stable hash of the canonical URL — the dedupe key. */
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  /** Display name of where it came from, e.g. "Import AI". */
  source: string;
  kind: SourceKind;
  /** ISO 8601. Falls back to discovery time when a feed omits a date. */
  publishedAt: string;
  author?: string;
  /** Feed-provided description or abstract, already stripped of markup. */
  summary?: string;
  /** Topic hints from config; the model is free to disagree. */
  topicHints?: Topic[];
  /** Engagement numbers, where the source exposes them. */
  signals?: {
    points?: number;
    comments?: number;
    likes?: number;
    reposts?: number;
  };
}

/** A candidate after the triage pass. */
export interface ScoredItem extends RawItem {
  score: number;
  topic: Topic;
  /** One line, for the run log — never shown on the site. */
  rationale: string;
}

/** A candidate that made the final cut. */
export interface CuratedItem {
  title: string;
  url: string;
  source: string;
  kind: SourceKind;
  publishedAt: string;
  topic: Topic;
  /** The 2–3 sentence "why this matters" note. */
  note: string;
  author?: string;
  /** Minutes, estimated from the extracted text where available. */
  readingMinutes?: number;
}

/**
 * The day's read across every candidate, not just the seven that made it.
 * Produced by a pass that sees the whole pool, so it can speak to mood rather
 * than to the picks.
 */
export interface Pulse {
  /** Two or three sentences on the state of play. */
  text: string;
  /** 0–100. A reading of today's evidence, not a forecast. */
  barometer: number;
  /** One line saying what moved it. */
  reading: string;
}

export interface Curation {
  kind: "daily" | "weekly";
  /** YYYY-MM-DD for daily, the Sunday's date for weekly. */
  date: string;
  /** URL slug: "2026-09-18" (daily) or "2026-W38" (weekly). */
  slug: string;
  generatedAt: string;
  /** One sentence setting up the day. Optional by design — may be omitted. */
  intro?: string;
  /** Absent on --no-llm runs and on weekly editions. */
  pulse?: Pulse;
  items: CuratedItem[];
  stats: {
    considered: number;
    sources: number;
    /** Absent on --no-llm runs. */
    model?: string;
  };
}
