import { MODEL, loadBrief } from "./config.ts";
import { select } from "./curate.ts";
import { extractAll } from "./extract.ts";
import { listCurations, recentDailies, writeCuration } from "./store.ts";
import type { Curation, RawItem, ScoredItem } from "./types.ts";
import { canonicalizeUrl, hashId, isoDate, isoWeekSlug, log, warn } from "./util.ts";

/**
 * The Sunday edition re-reads the week's daily picks and keeps only what still
 * looks worth reading with hindsight. It reuses the selection pass directly —
 * these items already survived triage once.
 */
async function main(): Promise<void> {
  const date = isoDate();
  const slug = isoWeekSlug();
  console.log(`\n學無止盡 — best of ${slug} (week ending ${date})\n`);

  const dailies = recentDailies(7);
  if (dailies.length < 2) {
    warn("weekly", `only ${dailies.length} daily curation(s) on disk — nothing to review`);
    process.exit(1);
  }

  const candidates: ScoredItem[] = [];
  const seen = new Set<string>();
  for (const daily of dailies) {
    for (const item of daily.items) {
      const canonicalUrl = canonicalizeUrl(item.url);
      if (seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      const raw: RawItem = {
        id: hashId(canonicalUrl),
        title: item.title,
        url: item.url,
        canonicalUrl,
        source: item.source,
        kind: item.kind,
        publishedAt: item.publishedAt,
        author: item.author,
        // The daily note is the best one-paragraph description we have.
        summary: item.note,
      };
      candidates.push({ ...raw, score: 100, topic: item.topic, rationale: "daily pick" });
    }
  }

  log("weekly", `${candidates.length} picks from ${dailies.length} daily editions`);

  const brief = loadBrief();
  const extracted = await extractAll(candidates);
  // The week's picks are both the finalists and the whole intake here: they
  // are all the model needs to read, and all it should base the pulse on.
  const result = await select(brief, candidates, extracted, {
    kind: "weekly",
    date,
    allCandidates: candidates,
    previousBarometer: listCurations("weekly").find((c) => c.slug < slug)?.pulse
      ?.barometer,
  });

  if (!result.items.length) {
    warn("weekly", "nothing selected — leaving the previous weekly in place");
    process.exit(1);
  }

  const curation: Curation = {
    kind: "weekly",
    date,
    slug,
    generatedAt: new Date().toISOString(),
    intro: result.intro,
    pulse: result.pulse,
    items: result.items,
    stats: {
      considered: candidates.length,
      sources: new Set(candidates.map((item) => item.source)).size,
      model: MODEL,
    },
  };

  const file = writeCuration(curation);
  console.log(`\n${curation.items.length} items → ${file}\n`);
  for (const [i, item] of curation.items.entries()) {
    console.log(`  ${String(i + 1).padStart(2, "0")}  ${item.title}`);
  }
  console.log();
}

main().catch((error) => {
  console.error(`\nweekly run failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
