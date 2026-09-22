import type { APIRoute } from "astro";
import { dailies, weeklies, formatWeek } from "../lib/data";
import type { Curation } from "../lib/data";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One feed item per edition, with the whole curation in the body. */
function renderItem(curation: Curation, site: string, base: string): string {
  const path =
    curation.kind === "weekly" ? `w/${curation.slug}` : `d/${curation.slug}`;
  const link = `${site}${base}${path}`;
  const title =
    curation.kind === "weekly"
      ? `Best of ${formatWeek(curation.slug)}`
      : curation.date;
  const body = [
    curation.intro ? `<p><em>${escape(curation.intro)}</em></p>` : "",
    "<ol>",
    ...curation.items.map(
      (item) =>
        `<li><a href="${escape(item.url)}">${escape(item.title)}</a>` +
        ` — <small>${escape(item.source)}</small><br>${escape(item.note)}</li>`,
    ),
    "</ol>",
  ].join("");

  return `    <item>
      <title>${escape(title)}</title>
      <link>${escape(link)}</link>
      <guid isPermaLink="true">${escape(link)}</guid>
      <pubDate>${new Date(curation.generatedAt).toUTCString()}</pubDate>
      <description><![CDATA[${body}]]></description>
    </item>`;
}

export const GET: APIRoute = ({ site }) => {
  const origin = (site?.origin ?? "https://example.com").replace(/\/$/, "");
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  const editions = [...weeklies, ...dailies]
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 40);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>學無止盡 · Infinite Learning</title>
    <link>${origin}${base}</link>
    <description>Infinite learning, for 10% apocalypse literacy.</description>
    <language>en</language>
${editions.map((c) => renderItem(c, origin, base)).join("\n")}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
