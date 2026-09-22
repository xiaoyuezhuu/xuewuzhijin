# 學無止盡 · Infinite Learning

*Infinite learning, for 10% apocalypse literacy.*

An automated daily curation of things worth reading — AI, AGI, alignment and
safety, the economics of AI, future technologies, neuroscience, and synthetic
biology. Seven items a day, no more. On Sundays, the best of the week.

The site is static. A scheduled GitHub Action does the reading, commits the
result as JSON, and redeploys the page.

```
sources ──▶ dedupe ──▶ triage (Claude) ──▶ fetch full text ──▶ select + write ──▶ data/*.json ──▶ site
```

## How the curation works

1. **Collect.** Every adapter in `pipeline/sources/` runs in parallel over a
   two-day window: RSS/Atom feeds (blogs, Substacks, journals), Hacker News via
   the free Algolia API, arXiv, Reddit, YouTube channel feeds, and X. An adapter
   that fails — dead feed, missing credential — logs a warning and returns
   nothing, so one bad source can't take down the day.
2. **Dedupe.** URLs are canonicalized (tracking parameters stripped) and titles
   normalized, so the same story arriving from three places counts once.
   `data/state/seen.json` remembers what has already been published, for 180
   days, so nothing appears twice.
3. **Triage.** Claude scores every candidate 0–100 against the editorial brief
   in `config/interests.md`, working from titles and summaries. Effort `medium`.
4. **Read.** The top survivors get fetched and run through Readability, so the
   final judgement is made on the actual text rather than the headline.
   Paywalls and JS-only pages simply fall back to their summary.
5. **Select, write, and take the pulse.** One call, effort `high`. It receives
   the finalists in full text *and* the rest of the day's intake as one line
   each, then returns three things: up to ten picks in priority order (the top
   seven that fit the subject caps are published), the notes, and the daily
   pulse with its barometer. Reading the finalists properly is what makes the
   pulse worth anything; the wider listing is what lets it describe the shape
   of the day rather than seven articles. It is told explicitly that fewer than
   seven items is the right answer on a quiet day, and is given the previous
   barometer as an anchor so the number moves rather than jitters.

The pulse is a by-product of selection by design — a separate pass would either
see only the seven picks (too narrow to speak to sentiment) or only headlines
(too shallow to say anything true).

The Sunday edition re-reads the week's picks and keeps only what still looks
worth reading with hindsight. It skips triage — those items already passed it.

## Setup

```bash
npm install
cp .env.example .env     # add your ANTHROPIC_API_KEY
npm run curate           # produce today's edition
npm run dev              # http://localhost:4321
```

`npm run curate:dry` runs the whole pipeline without calling the model — it
ranks heuristically and uses each source's own summary in place of a written
note. Useful for checking the plumbing and previewing layout; not curation.

### Credentials

| Variable | Needed for | Without it |
|---|---|---|
| `MODEL_API_KEY` | the curation itself (Meta Model API) | only `curate:dry` works |
| `ANTHROPIC_API_KEY` | the curation, when `LLM_PROVIDER=anthropic` | only `curate:dry` works |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit ([create a script app](https://www.reddit.com/prefs/apps)) | Reddit is skipped |
| `X_BEARER_TOKEN` | X/Twitter (needs a plan with recent-search access) | X is skipped |

## Tuning it

**`config/interests.md`** is the curator's prompt, read verbatim into the system
prompt on every run. Edit it in plain English. Being specific about what bores
you moves the output more than listing what interests you.

**`config/sources.yaml`** is the source list: 112 feeds in seven groups, plus
arXiv, Hacker News, Reddit, YouTube and X. Every feed was fetched and parsed on
2026-09-18.

| Group | Feeds | Shape of it |
|---|---:|---|
| Machine learning research & papers | 21 | HF Daily Papers, METR, DeepMind, OpenAI, Epoch AI, Google/Microsoft Research, BAIR, SAIL, EleutherAI — plus 7 arXiv categories |
| Alignment, safety & governance | 16 | Alignment Forum, LessWrong, Zvi, Redwood, CAIS, 80,000 Hours, AI Futures, Lawfare, ChinaTalk |
| Technology, economics & geopolitics | 18 | Stratechery, Noahpinion, Foreign Affairs, MIT Tech Review, Sequoia, Construction Physics, Tooze, War on the Rocks |
| Neuroscience & the mind | 9 | The Transmitter, Intrinsic Perspective, Neuron, bioRxiv, eLife, Quanta, Nautilus |
| Biology, progress & future tech | 12 | Asimov Press, In the Pipeline, bioRxiv SynBio, Works in Progress, Roots of Progress, Nintil |
| Researchers & individual voices | 34 | Twenty people at the frontier, eight adjacent voices, six social feeds — see below |
| Design & data storytelling | 2 | The Pudding, Minimal Gallery — off the main brief, delete the block to drop it |

### Following people, not just publications

The researcher group is three blocks. **The twenty** are personal blogs — Tao,
Bengio, Karpathy, Olah, Chollet, Aaronson, Christiano, Steinhardt, Nanda,
Leike, Carlini, Dettmers, Dieleman, Huszár, Sohl-Dickstein, Ha, Gwern, Ngo,
Millidge, Brundage. **Adjacent voices** adds policy and critique. **Social
feeds** uses the fact that Mastodon and Bluesky both expose RSS without an API
key: append `.rss` to a Mastodon profile URL, or `/rss` to a Bluesky one.

Every social account was identity-checked against Bluesky's public profile API
before being added, so none is a lookalike handle. Short posts lose to essays in
triage, which is the intended behaviour — the block exists so a Bengio or a Tao
post can surface on a day when it matters, not to fill slots.

Geoffrey Hinton has no blog and no Bluesky account. His X handle, with LeCun's
and Hassabis's, sits in the `x` queries and comes alive when `X_BEARER_TOKEN` is
set.

**Sources checked and rejected**, recorded in the file so nobody re-checks them:
Anthropic news and alignment.anthropic.com, transformer-circuits.pub, Sakana,
Meta AI, Allen Institute, Stanford HAI, Apollo Research, ARC. And all of
nature.com — it fingerprints the TLS handshake and serves Node an HTML
interstitial whatever headers you send.

After editing:After editing:

```bash
npm run sources:check              # pings every feed, reports what's broken
npm run sources:youtube -- @handle # resolves a YouTube handle to a channel ID
```

## The balance, and the barometer

The site is about AI risk literacy, so the subject mix is enforced rather than
hoped for. AI, AGI, Alignment, Economics and FutureTech compete freely for the
seven slots; **Neuroscience, SynBio, Geopolitics and Design take at most one
each**. The prompt states it and `TOPIC_CAPS` in `pipeline/config.ts` enforces
it after the model has chosen, which is why the model is asked for ten picks —
the extras are backfill when a cap bites.

The barometer is a 0–100 reading of *the day's intake*, not a forecast and not
the model's own view of AI risk. The prompt gives it five calibrated bands and
tells it most days sit between 30 and 60. The track on the page runs calm →
acute as its own legend, with hairlines at the 40 and 60 band boundaries.

## Topics and colour

Each item carries one topic, and topics collapse into four colour families for
the kicker above each headline — technology blue, life sciences green, money and
power orange, design violet. The mapping lives in `TOPIC_FAMILY`
(`pipeline/types.ts`); the colours are the `--topic-*` tokens in
`src/styles/global.css`, and all eight light/dark combinations clear WCAG AA.

The switch in the nav follows your system preference until you touch it, then
remembers your choice in `localStorage`.

Knobs in `pipeline/config.ts`: `MAX_ITEMS` (7), `DAILY_WINDOW_DAYS` (2),
`FINALIST_COUNT` (18 items get their full text fetched), `MODEL`.

## Deploying

The workflows target GitHub Pages out of the box:

- `.github/workflows/daily.yml` — 11:00 UTC daily: curate, commit, publish.
- `.github/workflows/weekly.yml` — 14:00 UTC Sundays: assemble the week, publish.
- `.github/workflows/deploy.yml` — builds and deploys; also runs on push to `main`.

To set it up: enable Pages with **Source: GitHub Actions** in repository
settings, then add `ANTHROPIC_API_KEY` (and any optional credentials) under
*Settings → Secrets and variables → Actions*. Cron times are UTC, and GitHub's
scheduler can run a scheduled job late under load.

For a custom domain or another host, set the repository variables `BASE_PATH`
(`/` at a domain root) and `SITE_URL`. The same build works on Vercel or
Netlify — build `npm run build`, publish `dist`.

## Models and cost

Two requests per day. Roughly **47K input tokens** for triage and **40K** for
the combined selection-and-pulse pass (finalists in full, plus one line for
every other candidate), with maybe 20K output once reasoning tokens are
counted.

The default is **Muse Spark 1.3 Standard** on the Meta Model API, which speaks
the OpenAI Chat Completions protocol. Reasoning tokens there count against
`max_tokens` as well as being billed as output, which is why the per-pass
`maxTokens` in `pipeline/config.ts` is set generously — running out mid-call
wastes the whole request.

| Setting | Est./month |
|---|---:|
| Muse Spark 1.3 Standard (default) | ~$7 |
| Muse Spark 1.3 Contributor | ~$0.60 — but Meta trains on your prompts and outputs |
| Claude Opus 5 | ~$28 |
| Claude Sonnet 5 | ~$14 |

Switching is environment-only: `LLM_PROVIDER=anthropic`, or `TRIAGE_MODEL` /
`SELECT_MODEL` to move one pass. `pipeline/llm.ts` holds both provider paths
and validates every response against the same Zod schema, so a provider change
can't quietly alter the data the site reads.

```bash
npm run llm:check    # one tiny call per pass; reports exactly what is broken
```

## Layout

```
config/          the editorial brief and the source list — the two files you edit
pipeline/        collection, dedupe, extraction, and the two Claude passes
  sources/       one adapter per platform
data/            committed output: daily/, weekly/, and the seen-items store
src/             the Astro site — layout, components, pages, one stylesheet
```
