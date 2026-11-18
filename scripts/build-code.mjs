/* global console, process, Buffer */
// Builds the plugin code: bundles code.ts (and src/) into code.js.
//
// - The plugin version comes from package.json ("version") and is injected as
//   __PLUGIN_VERSION__ (see src/version.ts); the plugin name comes from
//   manifest.json ("name") as __PLUGIN_NAME__. Bump it with `npm version minor`
//   (or major/patch) rather than editing it in several places.
// - The file templates are read from templates/*.json and provided as the
//   module "build:all-templates" (see src/templates.ts). Adding a JSON file there
//   adds a template; no code changes needed.
//
// - The templates are checked with the plugin's own template checks: errors stop
//   the build (while watching, they're printed on every rebuild instead).
//
// Pass --watch to rebuild on changes (including added/removed templates).

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'templates');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { name: pluginName } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

/** Every templates/*.json, with its file name as id. */
const templateImporter = {
  name: 'template-importer',
  setup(build) {
    build.onResolve({ filter: /^build:all-templates$/ }, () => ({ path: 'templates', namespace: 'templates' }));
    build.onLoad({ filter: /.*/, namespace: 'templates' }, () => {
      const files = readdirSync(templatesDir).filter((name) => name.endsWith('.json'));
      const templates = files.map((name) => ({ id: basename(name, '.json'), ...readJson(join(templatesDir, name)) }));
      return {
        contents: `export default ${JSON.stringify({ templates })};`,
        loader: 'js',
        watchDirs: [templatesDir],
        watchFiles: files.map((name) => join(templatesDir, name)),
      };
    });
  },
};

/**
 * Runs the plugin's own template checks (checkTemplate and templateWarnings in
 * src/templates.ts) on templates/*.json, in Node, so a broken template is caught
 * when building instead of when someone clicks Create.
 */
async function checkTemplates() {
  const { outputFiles } = await esbuild.build({
    stdin: {
      contents: "export { TEMPLATES, checkTemplate, templateWarnings } from './src/templates';",
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [templateImporter],
  });
  const checks = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
  return {
    errors: checks.TEMPLATES.flatMap((template) => checks.checkTemplate(template)),
    warnings: checks.TEMPLATES.flatMap((template) => checks.templateWarnings(template)),
  };
}

/** Prints the template check results; returns whether there were errors. */
async function reportTemplateChecks() {
  try {
    const { errors, warnings } = await checkTemplates();
    for (const warning of warnings) console.warn(`[templates] warning: ${warning}`);
    for (const error of errors) console.error(`[templates] error: ${error}`);
    return errors.length > 0;
  } catch (error) {
    console.error(`[templates] error: ${error.message}`);
    return true;
  }
}

const options = {
  entryPoints: [join(root, 'code.ts')],
  outfile: join(root, 'code.js'),
  bundle: true,
  target: 'es2020',
  logLevel: 'warning',
  define: { __PLUGIN_VERSION__: JSON.stringify(version), __PLUGIN_NAME__: JSON.stringify(pluginName) },
  plugins: [templateImporter],
};

if (process.argv.includes('--watch')) {
  // While watching, template problems are printed on every rebuild but don't stop it.
  const checkOnRebuild = { name: 'template-check', setup: (build) => build.onEnd(() => reportTemplateChecks()) };
  const ctx = await esbuild.context({ ...options, plugins: [...options.plugins, checkOnRebuild] });
  await ctx.watch();
  console.log(`[build-code] watching (v${version})…`);
} else {
  // A template that can't be built stops the build, so it never reaches users.
  if (await reportTemplateChecks()) {
    console.error('[build-code] stopped: fix the template errors above.');
    process.exit(1);
  }
  await esbuild.build(options);
  console.log(`[build-code] wrote code.js (v${version})`);
}
