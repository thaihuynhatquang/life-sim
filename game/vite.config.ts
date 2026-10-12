import { defineConfig } from 'vite';

// The data files built by data/pipeline are served as static files (fetched at start-up).
export default defineConfig({
  publicDir: '../data/out',
  server: { port: 5173 },
  plugins: [{
    // robots.txt for search engines (the public folder is the data folder, so it is written here).
    name: 'robots',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nAllow: /\n' }); },
  }],
});
