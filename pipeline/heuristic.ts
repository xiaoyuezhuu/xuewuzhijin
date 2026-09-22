import { MAX_ITEMS, TOPIC_CAPS } from "./config.ts";
import type { CuratedItem, RawItem, Topic } from "./types.ts";

const KEYWORDS: [RegExp, Topic, number][] = [
  [/\balign|interpretab|safety|eval(uation)?s?\b|red.?team|deceptive/i, "Alignment", 14],
  [/\bAGI|superintelligen|frontier model|scaling law|timelines?\b/i, "AGI", 12],
  [/\blabou?r market|productivity|GDP|automation|wages?|adoption\b/i, "Economics", 10],
  [/\bneuro|cortex|synap|brain|cognitio|connectom/i, "Neuroscience", 12],
  [/\bprotein|genome|CRISPR|synthetic biolog|cell|biosecurit/i, "SynBio", 12],
  [/\bexport control|sanction|geopolit|China|Taiwan|policy|regulat|state capacity/i, "Geopolitics", 10],
  [/\bfusion|reactor|space|material|photonic|quantum|energy\b/i, "FutureTech", 8],
  [/\bvisuali[sz]|interactive essay|typograph|data stor|web design/i, "Design", 6],
  [/\bLLM|transformer|model|training|inference|agent|benchmark/i, "AI", 6],
];

/** Kind-level priors: hand-picked feeds beat aggregators beat firehoses. */
const KIND_WEIGHT: Record<RawItem["kind"], number> = {
  rss: 22,
  youtube: 12,
  hn: 8,
  arxiv: 4,
  reddit: 2,
  x: 0,
};

export function prescore(item: RawItem): number {
  let score = 40 + KIND_WEIGHT[item.kind];

  const ageHours = (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000;
  score += Math.max(0, 16 - ageHours / 3);

  const engagement =
    (item.signals?.points ?? 0) + (item.signals?.likes ?? 0) / 3;
  if (engagement > 0) score += Math.min(20, Math.log10(engagement + 1) * 9);

  const haystack = `${item.title} ${item.summary ?? ""}`;
  for (const [pattern, , weight] of KEYWORDS) {
    if (pattern.test(haystack)) score += weight;
  }

  // Shape penalties the editorial brief calls out explicitly.
  if (/\b\d+ (things|ways|reasons|tips)\b/i.test(item.title)) score -= 25;
  if (/\braises? \$|funding round|series [A-E]\b|valuation/i.test(item.title)) score -= 20;

  return score;
}

export function guessTopic(item: RawItem): Topic {
  if (item.topicHints?.length) return item.topicHints[0]!;
  const haystack = `${item.title} ${item.summary ?? ""}`;
  let best: [Topic, number] = ["AI", 0];
  for (const [pattern, topic, weight] of KEYWORDS) {
    if (pattern.test(haystack) && weight > best[1]) best = [topic, weight];
  }
  return best[0];
}

/**
 * The --no-llm path: ranks by the heuristic above and uses each item's own
 * summary in place of a written note. Useful for checking the plumbing and
 * previewing layout without spending API calls; not a substitute for curation.
 */
export function heuristicCurate(items: RawItem[]): CuratedItem[] {
  const ranked = [...items].sort((a, b) => prescore(b) - prescore(a));
  const picked: CuratedItem[] = [];
  const perSource = new Map<string, number>();
  const perTopic = new Map<Topic, number>();

  for (const item of ranked) {
    if (picked.length >= MAX_ITEMS) break;
    const count = perSource.get(item.source) ?? 0;
    if (count >= 2) continue;

    // Same subject ceilings the real selection uses.
    const topic = guessTopic(item);
    const cap = TOPIC_CAPS[topic];
    const taken = perTopic.get(topic) ?? 0;
    if (cap !== undefined && taken >= cap) continue;

    perSource.set(item.source, count + 1);
    perTopic.set(topic, taken + 1);
    const summary = (item.summary ?? "").trim();
    picked.push({
      title: item.title,
      url: item.url,
      source: item.source,
      kind: item.kind,
      publishedAt: item.publishedAt,
      topic,
      note: summary
        ? summary.slice(0, 280).replace(/\s+\S*$/, "…")
        : "No summary available from the source.",
      author: item.author,
    });
  }
  return picked;
}
