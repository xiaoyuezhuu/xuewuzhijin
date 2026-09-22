import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Topic } from "./types.ts";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const CONFIG_DIR = path.join(ROOT, "config");

export interface RssSource {
  name: string;
  url: string;
  topics?: Topic[];
}

export interface YoutubeChannel {
  name: string;
  channelId: string;
  topics?: Topic[];
}

export interface SourcesConfig {
  rss: RssSource[];
  hn: { enabled: boolean; minPoints: number; queries: string[] };
  arxiv: {
    enabled: boolean;
    maxPerCategory: number;
    categories: string[];
    keywords: string[];
  };
  reddit: { enabled: boolean; minScore: number; subreddits: string[] };
  youtube: { enabled: boolean; channels: YoutubeChannel[] };
  x: { enabled: boolean; minLikes: number; maxResults: number; queries: string[] };
}

const DEFAULTS: SourcesConfig = {
  rss: [],
  hn: { enabled: false, minPoints: 100, queries: [] },
  arxiv: { enabled: false, maxPerCategory: 10, categories: [], keywords: [] },
  reddit: { enabled: false, minScore: 100, subreddits: [] },
  youtube: { enabled: false, channels: [] },
  x: { enabled: false, minLikes: 100, maxResults: 50, queries: [] },
};

export function loadSources(): SourcesConfig {
  const raw = parse(fs.readFileSync(path.join(CONFIG_DIR, "sources.yaml"), "utf8")) ?? {};
  return {
    rss: raw.rss ?? DEFAULTS.rss,
    hn: { ...DEFAULTS.hn, ...(raw.hn ?? {}) },
    arxiv: { ...DEFAULTS.arxiv, ...(raw.arxiv ?? {}) },
    reddit: { ...DEFAULTS.reddit, ...(raw.reddit ?? {}) },
    youtube: { ...DEFAULTS.youtube, ...(raw.youtube ?? {}) },
    x: { ...DEFAULTS.x, ...(raw.x ?? {}) },
  };
}

export function loadBrief(): string {
  return fs.readFileSync(path.join(CONFIG_DIR, "interests.md"), "utf8").trim();
}

/** How many items a curation holds. The brief is explicit that fewer is fine. */
export const MAX_ITEMS = 7;

/**
 * Per-topic ceilings. The site is about AI risk literacy, so AI, AGI,
 * Alignment, Economics and FutureTech compete freely for slots while the
 * supporting subjects take one apiece at most. Enforced in code after the
 * model has chosen, so a slip can't quietly flood the edition.
 */
export const TOPIC_CAPS: Partial<Record<Topic, number>> = {
  Neuroscience: 1,
  SynBio: 1,
  Geopolitics: 1,
  Design: 1,
};

/** Extra picks requested beyond MAX_ITEMS, as backfill when a cap bites. */
export const PICK_OVERSAMPLE = 3;

/** How far back a daily run looks for candidates. */
export const DAILY_WINDOW_DAYS = 2;

/** How many triage survivors get their full text fetched for the final pass. */
export const FINALIST_COUNT = 18;

export type Provider = "meta" | "anthropic";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type PassName = "triage" | "select";

export interface PassConfig {
  provider: Provider;
  model: string;
  effort: Effort;
  /**
   * On the Meta endpoint, reasoning tokens count against this limit as well as
   * the visible answer, so these are set generously. Running out mid-response
   * costs the whole call.
   */
  maxTokens: number;
}

const provider = (process.env.LLM_PROVIDER ?? "meta") as Provider;

const DEFAULT_MODEL: Record<Provider, string> = {
  meta: "muse-spark-1.3",
  anthropic: "claude-opus-5",
};

function passConfig(
  envKey: string,
  effort: Effort,
  maxTokens: number,
): PassConfig {
  return {
    provider,
    model: process.env[envKey] ?? DEFAULT_MODEL[provider],
    effort,
    maxTokens,
  };
}

/**
 * Per-pass model settings. Triage is a big, mechanical scoring job; selection
 * carries the judgement and the writing, so it gets the higher effort. Both
 * can be pointed at a different model with TRIAGE_MODEL / SELECT_MODEL.
 */
export const LLM: Record<PassName, PassConfig> = {
  triage: passConfig("TRIAGE_MODEL", "medium", 32_000),
  select: passConfig("SELECT_MODEL", "high", 32_000),
};

/** Recorded in each curation's stats so an edition says what wrote it. */
export const MODEL = LLM.select.model;
