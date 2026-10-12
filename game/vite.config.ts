import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const SITE = 'https://life-sim.quangthn.net/';

// The data files built by data/pipeline are served as static files (fetched at start-up).
export default defineConfig({
  publicDir: '../data/out',
  server: { port: 5173 },
  plugins: [{
    // Files for search engines and link previews (the public folder is the data folder, so they are written here).
    name: 'site-files',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n` });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE}</loc></url></urlset>\n` });
      this.emitFile({ type: 'asset', fileName: 'og-image.png', source: readFileSync('og-image.png') });
    },
  }],
});
