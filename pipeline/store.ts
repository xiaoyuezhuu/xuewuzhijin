import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.ts";
import type { Curation } from "./types.ts";

function dirFor(kind: Curation["kind"]): string {
  return path.join(DATA_DIR, kind === "daily" ? "daily" : "weekly");
}

export function writeCuration(curation: Curation): string {
  const dir = dirFor(curation.kind);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${curation.slug}.json`);
  fs.writeFileSync(file, `${JSON.stringify(curation, null, 2)}\n`);
  return file;
}

export function listCurations(kind: Curation["kind"]): Curation[] {
  const dir = dirFor(kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Curation)
    .sort((a, b) => b.slug.localeCompare(a.slug));
}

/**
 * The most recent daily strictly before `slug` — used to carry the barometer
 * forward, so today's reading is anchored rather than starting from nothing.
 * Skips today's own file, which may already exist from an earlier run.
 */
export function previousDaily(slug: string): Curation | undefined {
  return listCurations("daily").find((c) => c.slug < slug);
}

/** The N most recent dailies, newest first. */
export function recentDailies(days: number): Curation[] {
  return listCurations("daily").slice(0, days);
}
