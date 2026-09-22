import { defineConfig } from "astro/config";

// BASE_PATH lets the same build target GitHub Pages (/repo-name) or a root
// domain on Vercel/Netlify (/). SITE_URL is only used for absolute URLs in
// the RSS feed and meta tags.
const base = process.env.BASE_PATH ?? "/";
const site = process.env.SITE_URL ?? "https://example.com";

export default defineConfig({
  site,
  base,
  trailingSlash: "ignore",
  build: { format: "directory" },
  devToolbar: { enabled: false },
});
