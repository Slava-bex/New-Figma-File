/* global console, process, Buffer, setTimeout, clearTimeout */
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

import { readdirSync, readFileSync, watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = join(root, 'templates');
const readVersion = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const version = readVersion();
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

const optionsFor = (version) => ({
  entryPoints: [join(root, 'code.ts')],
  outfile: join(root, 'code.js'),
  bundle: true,
  target: 'es2020',
  logLevel: 'warning',
  define: { __PLUGIN_VERSION__: JSON.stringify(version), __PLUGIN_NAME__: JSON.stringify(pluginName) },
  plugins: [templateImporter],
});
const options = optionsFor(version);

if (process.argv.includes('--watch')) {
  // While watching, template problems are printed on every rebuild but don't stop it.
  // (onEnd may only return nothing or an object, so the result isn't passed on.)
  const checkOnRebuild = {
    name: 'template-check',
    setup: (build) =>
      build.onEnd(async () => {
        await reportTemplateChecks();
      }),
  };
  const startWatching = async (version) => {
    const context = await esbuild.context({ ...optionsFor(version), plugins: [templateImporter, checkOnRebuild] });
    await context.watch();
    console.log(`[build-code] watching (v${version})…`);
    return context;
  };
  let watchedVersion = version;
  let ctx = await startWatching(version);

  // A new version in package.json: the version is built into the code, so watch again
  // with the new one. (The folder is watched, as editors may replace the file on save.)
  let timer;
  watch(root, (_event, file) => {
    if (file !== 'package.json') return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let next;
      try {
        next = readVersion();
      } catch {
        return; // half-written while saving; the next change event follows
      }
      if (!next || next === watchedVersion) return;
      watchedVersion = next;
      await ctx.dispose();
      ctx = await startWatching(next);
    }, 100);
  });
} else {
  // A template that can't be built stops the build, so it never reaches users.
  if (await reportTemplateChecks()) {
    console.error('[build-code] stopped: fix the template errors above.');
    process.exit(1);
  }
  await esbuild.build(options);
  console.log(`[build-code] wrote code.js (v${version})`);
}
