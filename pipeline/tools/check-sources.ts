import { loadSources } from "../config.ts";
import { fetchFeed } from "../sources/feed.ts";
import { mapLimit } from "../util.ts";

/**
 * Pings every configured feed and reports what it got back. Run this after
 * editing config/sources.yaml — a feed that fails here is silently skipped
 * during a real run.
 */
async function main(): Promise<void> {
  const config = loadSources();
  // Names and URLs are coerced: an unquoted comma in the YAML turns a name
  // into a number, and a crash here is a worse report than a warning.
  const feeds = [
    ...config.rss.map((s) => ({ name: String(s.name), url: String(s.url) })),
    ...config.youtube.channels.map((c) => ({
      name: `YouTube: ${String(c.name)}`,
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`,
    })),
  ];

  console.log(`\nChecking ${feeds.length} feeds…\n`);

  const results = await mapLimit(feeds, 6, async (feed) => {
    try {
      const entries = await fetchFeed(feed.url);
      const latest = entries
        .map((e) => (e.publishedAt ? new Date(e.publishedAt) : null))
        .filter((d): d is Date => !!d && !Number.isNaN(d.valueOf()))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const age = latest
        ? `${Math.floor((Date.now() - latest.getTime()) / 86_400_000)}d ago`
        : "no dates";
      return { ok: true, name: feed.name, url: feed.url, detail: `${entries.length} items, latest ${age}` };
    } catch (error) {
      return { ok: false, name: feed.name, url: feed.url, detail: (error as Error).message };
    }
  });

  for (const result of results.filter((r) => r.ok)) {
    console.log(`  ✓ ${result.name.padEnd(28)} ${result.detail}`);
  }
  const failures = results.filter((r) => !r.ok);
  if (failures.length) {
    console.log("");
    for (const failure of failures) {
      console.log(`  ✗ ${failure.name.padEnd(28)} ${failure.detail}`);
      console.log(`    ${failure.url}`);
    }
  }
  console.log(`\n${results.length - failures.length} ok, ${failures.length} failing\n`);
  if (failures.length) process.exitCode = 1;
}

main();
