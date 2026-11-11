// Injected at build time from package.json (scripts/build-code.mjs).
declare const __PLUGIN_VERSION__: string;

/** Full version, e.g. "2.0.0". "dev" if the build didn't inject one (e.g. an outdated watch process). */
export const VERSION = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev';

/** Short version for display, e.g. "v2.0" (the patch number is left out when it's 0). */
export const DISPLAY_VERSION = (() => {
  if (VERSION === 'dev') return VERSION;
  const [major = '0', minor = '0', patch = '0'] = VERSION.split(/[.+-]/);
  return patch === '0' ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
})();
