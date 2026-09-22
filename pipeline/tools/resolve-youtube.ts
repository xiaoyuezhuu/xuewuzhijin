import { fetchWithTimeout } from "../util.ts";

/**
 * YouTube's Atom feeds are keyed by channel ID, not handle.
 *   npm run sources:youtube -- @dwarkeshpatel
 */
async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run sources:youtube -- @handle | <channel url>");
    process.exitCode = 1;
    return;
  }

  const url = input.startsWith("http")
    ? input
    : `https://www.youtube.com/${input.startsWith("@") ? input : `@${input}`}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.error(`could not load ${url} (HTTP ${res.status})`);
    process.exitCode = 1;
    return;
  }

  const html = await res.text();
  const channelId =
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/channel\/(UC[\w-]{22})/)?.[1];
  const name =
    html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? input;

  if (!channelId) {
    console.error("no channel ID found on that page");
    process.exitCode = 1;
    return;
  }

  console.log(`\nAdd to config/sources.yaml under youtube.channels:\n`);
  console.log(`  - { name: ${name}, channelId: "${channelId}", topics: [AI] }\n`);
}

main();
