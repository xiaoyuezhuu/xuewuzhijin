import fs from "node:fs";
import path from "node:path";
import type { Curation, SourceKind, Topic } from "../../pipeline/types.ts";
import { TOPIC_FAMILY } from "../../pipeline/types.ts";

export type { Curation, CuratedItem, Topic } from "../../pipeline/types.ts";
export { TOPIC_FAMILY } from "../../pipeline/types.ts";

const DATA_DIR = path.join(process.cwd(), "data");

function read(kind: "daily" | "weekly"): Curation[] {
  const dir = path.join(DATA_DIR, kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Curation)
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

/** Newest first. */
export const dailies = read("daily");
export const weeklies = read("weekly");

export const latestDaily = dailies[0];
export const latestWeekly = weeklies[0];

export const TOPIC_LABELS: Record<Topic, string> = {
  AI: "Artificial Intelligence",
  AGI: "AGI",
  Alignment: "Alignment & Safety",
  Economics: "Economics",
  Geopolitics: "Geopolitics",
  FutureTech: "Future Tech",
  Neuroscience: "Neuroscience",
  SynBio: "Synthetic Biology",
  Design: "Design",
};

/** Falls back to the technology family for anything unrecognized. */
export function familyOf(topic: Topic): string {
  return TOPIC_FAMILY[topic] ?? "tech";
}

/** Only says something when the medium isn't obvious from the source name. */
export const KIND_LABELS: Partial<Record<SourceKind, string>> = {
  youtube: "video",
  arxiv: "preprint",
  x: "post",
  hn: "thread",
  reddit: "thread",
};

export function formatLongDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "18 Sep 2026" — compact enough for the archive's fixed date column. */
export function formatArchiveDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Turns "2026-W38" into "Week 38, 2026". */
export function formatWeek(slug: string): string {
  const [year, week] = slug.split("-W");
  return `Week ${Number(week)}, ${year}`;
}

/** Prefixes a path with the configured base, for GitHub Pages subpaths. */
export function href(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${pathname.replace(/^\//, "")}`.replace(/\/$/, "") || "/";
}

/** The barometer from the edition before `slug`, for the change line. */
export function previousBarometer(
  slug: string,
  kind: "daily" | "weekly" = "daily",
): number | undefined {
  const editions = kind === "weekly" ? weeklies : dailies;
  return editions.find((c) => c.slug < slug)?.pulse?.barometer;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
