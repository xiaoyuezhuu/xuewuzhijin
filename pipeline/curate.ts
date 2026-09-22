import { z } from "zod";
import {
  FINALIST_COUNT,
  MAX_ITEMS,
  PICK_OVERSAMPLE,
  TOPIC_CAPS,
} from "./config.ts";
import { generate } from "./llm.ts";
import type { Extracted } from "./extract.ts";
import { readingMinutes } from "./extract.ts";
import { TOPICS } from "./types.ts";
import type { CuratedItem, Pulse, RawItem, ScoredItem, Topic } from "./types.ts";
import { log, warn } from "./util.ts";

const TriageSchema = z.object({
  scores: z.array(
    z.object({
      index: z.number().int().describe("The candidate's [n] number."),
      score: z
        .number()
        .int()
        .describe("0–100. Above 70 means genuinely worth the reader's time."),
      topic: z.enum(TOPICS),
      rationale: z.string().describe("At most 12 words, for the run log."),
    }),
  ),
});

const SelectionSchema = z.object({
  pulseText: z
    .string()
    .describe(
      "Two or three sentences on the state of play across AI development, " +
        "public sentiment, and the scientific community's mood. Plain prose, " +
        "no bullet points, no hedging throat-clearing.",
    ),
  barometer: z
    .number()
    .int()
    .describe("0–100, following the barometer calibration in the instructions."),
  barometerReading: z
    .string()
    .describe("One short line naming what actually moved the number today."),
  intro: z
    .string()
    .describe(
      "One sentence of at most 20 words naming the through-line of the day, " +
        "or an empty string if the items share no honest through-line.",
    ),
  picks: z.array(
    z.object({
      index: z.number().int().describe("The finalist's [n] number."),
      topic: z.enum(TOPICS),
      note: z
        .string()
        .describe("The 2–3 sentence 'why this matters' note, in the brief's voice."),
    }),
  ),
});

function briefSystem(brief: string, task: string): string {
  return `You are the editor of 學無止盡 ("Infinite Learning"), a daily curation of \
things worth reading for one specific reader. Your standards are high and your \
default answer is no.

${brief}

---

${task}`;
}

const TRIAGE_TASK = `Right now you are doing triage. You will be given a day's \
candidates as a numbered list. Score every candidate from 0 to 100 on whether it \
deserves one of seven slots, judging against the brief above.

Calibration:
- 85+: a substantive result, argument, or piece of reporting the reader would be \
worse off for missing.
- 70–84: solid and relevant, would make a thin day.
- 40–69: real but ordinary; coverage, incremental work, or well-trodden ground.
- Below 40: announcements, listicles, discourse, press-release journalism, or \
off-brief.

Judge the item, not its source: a strong post from an unknown blog outranks a \
weak one from a famous lab. Preprints are common and most are incremental — \
reserve high scores for ones with a surprising or load-bearing result. Score \
every candidate exactly once.`;

const SELECT_TASK = `You are making the final selection. You will be given the \
finalists, most with their full text. Choose the ones that earn a slot, then \
write each one's note.

The edition holds ${MAX_ITEMS} items. Return up to ${MAX_ITEMS + PICK_OVERSAMPLE} \
picks in strict priority order — best first — and the top ${MAX_ITEMS} that fit \
the subject limits below will be published. The extras are backfill; do not \
include anything you would be embarrassed to publish just to reach the count.

Subject limits — the site exists to keep one reader literate about AI risk, so \
the balance is deliberate and not negotiable:
- AI, AGI, Alignment, Economics and FutureTech compete freely for slots. On a \
normal day five or more of the seven come from AI, AGI and Alignment.
- Neuroscience, SynBio, Geopolitics and Design take AT MOST ONE SLOT EACH, and \
only for the single best item in that subject. These are supporting subjects: \
a neuroscience or biology result earns its slot when it bears on how minds or \
engineered systems actually work, not merely because it is good science.
- A strong AI item always outranks a strong item from a supporting subject.

Other rules:
- Fewer than ${MAX_ITEMS} is correct when fewer deserve it — a quiet day should \
look quiet. Never pad.
- Judge the actual text, not the headline. If the full text reveals a piece is \
thinner than it looked, drop it.
- Order them as a reader should meet them: the most consequential first, and \
don't put two items on the same subject back to back.
- Each note is 2–3 sentences saying what the piece actually claims or shows and \
why it matters. Follow the brief's voice section exactly. Never open with the \
title, never write "this piece" or "the author argues" as a crutch, never use \
"fascinating", "must-read", "deep dive", or "game-changing".

────────────────────────────────────────────────────────────────────────────
THE PULSE

Having read the finalists in full and seen the rest of the day's intake listed \
beneath them, also write the pulse: two or three sentences on the state of \
play. Cover, in whatever proportion the day warrants:
- where AI development actually stands today
- how the public and the press are reacting
- what the research community is preoccupied with

Ground it in what you just read. The finalists are the part you know in depth; \
the wider listing is there so you can speak to the shape of the day rather \
than to seven articles. Name specifics — a result, a number, a fight — rather \
than gesturing at "continued rapid progress". If the day is unremarkable, say \
so plainly: a boring day described honestly is more useful than a boring day \
inflated. No hype adjectives, no rhetorical questions, no "meanwhile".

THE APOCALYPSE BAROMETER, 0–100.

A reading of today's evidence — not a forecast, and not your own view about AI \
risk. It answers: how worrying does the field look from this day's intake?

- 0–20   Reassuring. Gains look incremental, safety work is landing, \
institutions are coping.
- 21–40  Calm. The ordinary business of a fast-moving field.
- 41–60  Mixed. The usual tension between capability and control, nothing acute.
- 61–80  Elevated. A real warning sign: a concerning eval result, a governance \
failure, a capability jump nobody has a handle on.
- 81–100 Acute. A serious loss-of-control indicator, major misuse, or an \
institutional failure with immediate consequences.

Most days sit between 30 and 60. When you are given a previous reading, treat \
it as the anchor and move from it only as far as today's evidence supports — a \
quiet day is the previous number adjusted by a point or two, not a low score. \
Do not manufacture drama to make the number interesting, and do not flatten a \
genuinely alarming day to seem measured.`;

function describeItem(item: RawItem, index: number, extracted?: Extracted): string {
  const parts = [
    `[${index}] ${item.title}`,
    `source: ${item.source} (${item.kind})`,
    `published: ${item.publishedAt.slice(0, 10)}`,
  ];
  if (item.author) parts.push(`author: ${item.author}`);
  const signals = item.signals ?? {};
  const signalText = [
    signals.points !== undefined ? `${signals.points} points` : null,
    signals.likes !== undefined ? `${signals.likes} likes` : null,
    signals.comments !== undefined ? `${signals.comments} comments` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (signalText) parts.push(`engagement: ${signalText}`);
  if (extracted) {
    parts.push(`length: ~${extracted.words} words`);
    parts.push(`full text: ${extracted.text.slice(0, 6000)}`);
  } else if (item.summary) {
    parts.push(`summary: ${item.summary.slice(0, 700)}`);
  } else {
    parts.push("summary: (none available)");
  }
  return parts.join("\n");
}

/** Stage one: score everything cheaply on titles and summaries. */
export async function triage(brief: string, items: RawItem[]): Promise<ScoredItem[]> {
  const listing = items.map((item, i) => describeItem(item, i)).join("\n\n");

  const parsed = await generate({
    pass: "triage",
    schema: TriageSchema,
    schemaName: "Triage",
    system: briefSystem(brief, TRIAGE_TASK),
    user: `Today's ${items.length} candidates:\n\n${listing}\n\nScore all ${items.length}.`,
  });

  const scored: ScoredItem[] = [];
  for (const row of parsed.scores) {
    const item = items[row.index];
    if (!item) continue;
    scored.push({
      ...item,
      score: Math.max(0, Math.min(100, row.score)),
      topic: row.topic as Topic,
      rationale: row.rationale,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  log(
    "triage",
    `scored ${scored.length}/${items.length}; top score ${scored[0]?.score ?? 0}, ` +
      `${scored.filter((s) => s.score >= 70).length} above 70`,
  );
  return scored;
}

/** Stage two: read the finalists in full, then pick and write. */
export async function select(
  brief: string,
  finalists: ScoredItem[],
  extracted: Map<string, Extracted>,
  context: {
    kind: "daily" | "weekly";
    date: string;
    /** The whole day's intake, for the pulse's sense of breadth. */
    allCandidates: RawItem[];
    /** The previous edition's barometer, as an anchor. */
    previousBarometer?: number;
  },
): Promise<{ intro?: string; items: CuratedItem[]; pulse?: Pulse }> {
  const listing = finalists
    .map((item, i) => describeItem(item, i, extracted.get(item.id)))
    .join("\n\n---\n\n");

  // Everything that didn't make the finalist cut, one line each. The model
  // reads the finalists properly and skims this for the shape of the day.
  const finalistIds = new Set(finalists.map((item) => item.id));
  const rest = context.allCandidates
    .filter((item) => !finalistIds.has(item.id))
    .map(
      (item) =>
        `- [${item.source}] ${item.title}` +
        (item.summary ? ` — ${item.summary.slice(0, 200)}` : ""),
    )
    .join("\n");

  const anchor =
    context.previousBarometer === undefined
      ? "There is no previous barometer reading — this is the first, so set it " +
        "from today's evidence alone and expect to land mid-range."
      : `The previous barometer reading was ${context.previousBarometer}. ` +
        "That is your anchor.";

  const framing =
    context.kind === "weekly"
      ? `This is the Sunday edition: the best of the week ending ${context.date}. ` +
        `These finalists already survived a daily cut, so the bar is higher still — ` +
        `pick only what still looks worth reading with a week's hindsight.`
      : `This is the daily edition for ${context.date}.`;

  const parsed = await generate({
    pass: "select",
    schema: SelectionSchema,
    schemaName: "Selection",
    system: briefSystem(brief, SELECT_TASK),
    user:
      `${framing}\n\n${anchor}\n\n` +
      `FINALISTS — read these in full:\n\n${listing}\n\n` +
      `────────────────────────────────────────\n` +
      `THE REST OF THE DAY'S INTAKE (${context.allCandidates.length - finalists.length} ` +
      `items, for the pulse only — these are not selectable):\n${rest}\n\n` +
      `Make the selection, then write the pulse.`,
  });

  const items: CuratedItem[] = [];
  const used = new Set<number>();
  const perTopic = new Map<Topic, number>();
  for (const pick of parsed.picks) {
    if (items.length >= MAX_ITEMS) break;
    if (used.has(pick.index)) continue;
    const item = finalists[pick.index];
    if (!item) continue;

    // The caps are enforced here rather than trusted to the prompt, which is
    // why the model is asked for more picks than the edition can hold.
    const topic = pick.topic as Topic;
    const cap = TOPIC_CAPS[topic];
    const taken = perTopic.get(topic) ?? 0;
    if (cap !== undefined && taken >= cap) {
      used.add(pick.index);
      log("select", `capped: "${item.title.slice(0, 48)}" (${topic} already at ${cap})`);
      continue;
    }
    perTopic.set(topic, taken + 1);
    used.add(pick.index);
    const words = extracted.get(item.id)?.words;
    items.push({
      title: item.title,
      url: item.url,
      source: item.source,
      kind: item.kind,
      publishedAt: item.publishedAt,
      topic: pick.topic as Topic,
      note: pick.note.trim(),
      author: item.author,
      readingMinutes: words ? readingMinutes(words) : undefined,
    });
  }

  const intro = parsed.intro?.trim();

  const barometer = Math.max(0, Math.min(100, Math.round(parsed.barometer)));
  const pulse: Pulse | undefined = parsed.pulseText?.trim()
    ? {
        text: parsed.pulseText.trim(),
        barometer,
        reading: parsed.barometerReading.trim(),
      }
    : undefined;

  log("select", `${items.length} items chosen from ${finalists.length} finalists`);
  if (pulse) log("pulse", `barometer ${pulse.barometer} — ${pulse.reading}`);
  return { intro: intro || undefined, items, pulse };
}

/**
 * Full LLM curation: triage everything, fetch the survivors, then select.
 * `fetchText` is injected so the weekly run can reuse already-picked items
 * without re-fetching.
 */
export async function curate(
  brief: string,
  candidates: RawItem[],
  fetchText: (items: RawItem[]) => Promise<Map<string, Extracted>>,
  context: { kind: "daily" | "weekly"; date: string; previousBarometer?: number },
): Promise<{ intro?: string; items: CuratedItem[]; pulse?: Pulse }> {
  const scored = await triage(brief, candidates);
  const finalists = scored
    .filter((item) => item.score >= 45)
    .slice(0, FINALIST_COUNT);

  if (!finalists.length) {
    warn("curate", "nothing cleared the triage floor");
    return { items: [] };
  }

  const extracted = await fetchText(finalists);
  return select(brief, finalists, extracted, { ...context, allCandidates: candidates });
}
