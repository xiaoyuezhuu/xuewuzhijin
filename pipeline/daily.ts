import { DAILY_WINDOW_DAYS, MODEL, loadBrief, loadSources } from "./config.ts";
import { curate } from "./curate.ts";
import { dedupe, recordSeen } from "./dedupe.ts";
import { extractAll } from "./extract.ts";
import { heuristicCurate, prescore } from "./heuristic.ts";
import { collectAll } from "./sources/index.ts";
import { previousDaily, writeCuration } from "./store.ts";
import type { Curation } from "./types.ts";
import { daysAgo, isoDate, log, warn } from "./util.ts";

/** Ceiling on what goes to triage, so one runaway feed can't blow up a run. */
const MAX_CANDIDATES = 300;

async function main(): Promise<void> {
  const useLlm = !process.argv.includes("--no-llm");
  const date = isoDate();
  console.log(`\n學無止盡 — daily curation for ${date}${useLlm ? "" : " (--no-llm)"}\n`);

  const sources = loadSources();
  const brief = loadBrief();
  const since = daysAgo(DAILY_WINDOW_DAYS);

  const collected = await collectAll(sources, since);
  const candidates = dedupe(collected, date);

  if (!candidates.length) {
    warn("daily", "no candidates found — leaving the previous curation in place");
    process.exit(1);
  }

  const pool = candidates
    .sort((a, b) => prescore(b) - prescore(a))
    .slice(0, MAX_CANDIDATES);
  if (candidates.length > pool.length) {
    log("daily", `capped ${candidates.length} candidates to ${pool.length} for triage`);
  }

  const result = useLlm
    ? await curate(brief, pool, extractAll, {
        kind: "daily",
        date,
        previousBarometer: previousDaily(date)?.pulse?.barometer,
      })
    : { items: heuristicCurate(pool), pulse: undefined };

  if (!result.items.length) {
    warn("daily", "nothing cleared the bar — leaving the previous curation in place");
    process.exit(1);
  }

  const curation: Curation = {
    kind: "daily",
    date,
    slug: date,
    generatedAt: new Date().toISOString(),
    intro: result.intro,
    pulse: result.pulse,
    items: result.items,
    stats: {
      considered: candidates.length,
      sources: new Set(collected.map((item) => item.source)).size,
      model: useLlm ? MODEL : undefined,
    },
  };

  const file = writeCuration(curation);
  recordSeen(curation.items, date);

  console.log(`\n${curation.items.length} items → ${file}`);
  if (result.pulse) {
    console.log(`barometer ${result.pulse.barometer}/100 — ${result.pulse.reading}\n`);
  } else {
    console.log(useLlm ? "" : "(no pulse on --no-llm runs)\n");
  }
  for (const [i, item] of curation.items.entries()) {
    console.log(`  ${String(i + 1).padStart(2, "0")}  ${item.title}`);
    console.log(`      ${item.source} · ${item.topic}`);
  }
  console.log();
}

main().catch((error) => {
  console.error(`\ndaily run failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
