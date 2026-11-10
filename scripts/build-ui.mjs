/* global console, process */
// Builds the plugin UI.
//
// Figma loads the plugin UI as a single HTML string, so it can't fetch local
// stylesheets or scripts. This script takes `ui.html` and inlines figui3
// (from node_modules) in place of the placeholders:
//
//   <!-- figui3:css -->  ->  <style>…fig.css…</style>
//   <!-- figui3:js -->   ->  <script>…fig.js bundled with its imports…</script>
//
// fig.js imports sibling modules (e.g. ./fig-color.js), so it is bundled with
// esbuild into a single self-contained script rather than copied verbatim.
//
// Output: dist/ui.html (referenced by manifest.json).
// Pass --watch to rebuild whenever ui.html changes.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = join(root, 'ui.html');
const outPath = join(root, 'dist', 'ui.html');

const figCss = readFileSync(require.resolve('@rogieking/figui3/fig.css'), 'utf8');
const figJs = buildSync({
  stdin: { contents: 'import "@rogieking/figui3/fig.js";', resolveDir: root },
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'inline',
  write: false,
}).outputFiles[0].text;

// Prevent the inlined code from closing its own tag early.
const safeCss = figCss.replace(/<\/style/gi, '<\\/style');
const safeJs = figJs.replace(/<\/script/gi, '<\\/script');

function build() {
  const src = readFileSync(srcPath, 'utf8');
  for (const marker of ['<!-- figui3:css -->', '<!-- figui3:js -->']) {
    if (!src.includes(marker)) throw new Error(`ui.html is missing the ${marker} placeholder`);
  }
  // Use replacer functions so `$` sequences in the library code aren't
  // interpreted as replacement patterns.
  const out = src
    .replace('<!-- figui3:css -->', () => `<style>${safeCss}</style>`)
    .replace('<!-- figui3:js -->', () => `<script>${safeJs}</script>`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  console.log(`[build-ui] wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB)`);
}

build();

if (process.argv.includes('--watch')) {
  console.log('[build-ui] watching ui.html…');
  watch(srcPath, () => {
    try {
      build();
    } catch (err) {
      console.error('[build-ui]', err.message);
    }
  });
}
