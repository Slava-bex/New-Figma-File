/* global console, process */
// Builds the plugin code: bundles code.ts (and src/) into code.js.
//
// - The plugin version comes from package.json ("version") and is injected as
//   __PLUGIN_VERSION__ (see src/version.ts). Bump it with `npm version minor`
//   (or major/patch) rather than editing it in several places.
// - The file templates are read from templates/*.json and provided as the
//   module "virtual:templates" (see src/templates.ts). Adding a JSON file there
//   adds a template; no code changes needed.
//
// Pass --watch to rebuild on changes (including added/removed templates).

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'templates');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Parses a JSON file, without its "$schema" (only there for the editor). */
function readJson(path) {
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
  delete json.$schema;
  return json;
}

/** templates/_shared.json plus every other templates/*.json, keyed by file name. */
const templatesPlugin = {
  name: 'templates',
  setup(build) {
    build.onResolve({ filter: /^virtual:templates$/ }, () => ({ path: 'templates', namespace: 'templates' }));
    build.onLoad({ filter: /.*/, namespace: 'templates' }, () => {
      const files = readdirSync(templatesDir).filter((name) => name.endsWith('.json'));
      const templates = files
        .filter((name) => !name.startsWith('_'))
        .map((name) => ({ id: basename(name, '.json'), ...readJson(join(templatesDir, name)) }));
      const shared = readJson(join(templatesDir, '_shared.json'));
      return {
        contents: `export default ${JSON.stringify({ shared, templates })};`,
        loader: 'js',
        watchDirs: [templatesDir],
        watchFiles: files.map((name) => join(templatesDir, name)),
      };
    });
  },
};

const options = {
  entryPoints: [join(root, 'code.ts')],
  outfile: join(root, 'code.js'),
  bundle: true,
  target: 'es2020',
  logLevel: 'warning',
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  plugins: [templatesPlugin],
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`[build-code] watching (v${version})…`);
} else {
  await esbuild.build(options);
  console.log(`[build-code] wrote code.js (v${version})`);
}
