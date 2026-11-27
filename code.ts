// Plugin entry point: opens the UI and handles its messages.
// What "Create file structure" builds is defined per template in templates/ (see templates/README.md).

import { captureFile } from './src/capture';
import {
  clearContributorName,
  contributorMemoryDebugInfo,
  loadContributorName,
  saveContributorName,
} from './src/contributor-memory';
import { createFile } from './src/create';
import { unavailableFields } from './src/availability';
import { fillProjectTeam, readOldCoverValues, watchOldCover } from './src/experimental/prefill-from-old-cover'; // EXPERIMENTAL: prefill-from-old-cover
import { sanitize } from './src/sanitize';
import { fileNameFor } from './src/placeholders';
import { checkTemplates, findTemplate, templateSummaries } from './src/templates';
import type { FileType, FormField, NewFileData } from './src/types';
import { DISPLAY_VERSION, PLUGIN_NAME } from './src/version';

type UIMessage =
  | { type: 'ready' }
  | { type: 'create-file'; data: NewFileData }
  | { type: 'open-url'; url: string }
  | { type: 'resize'; height: number }
  | { type: 'debug-clear-contributor' }
  | { type: 'debug-file-name'; data: NewFileData }
  | { type: 'fill-project-team' } // EXPERIMENTAL: prefill-from-old-cover
  | { type: 'capture-file' };

// Shows a "Capture this file as JSON template" tool on the File type step: turns the
// open file into a template file for templates/ (see templates/README.md).
// For building templates only; turn off before publishing.
const CAPTURE = false;

// Shows a debug panel under the form: a preview of the suggested file name, and
// (for templates with a Contributors field) the remembered contributor name:
// what's stored, what was pre-filled, and what happened on Create.
// Turn off before publishing.
const DEBUG = false;

// EXPERIMENTAL: prefill-from-old-cover (start)
// For files with an old cover, Figma only: pre-fills the form from the old cover, and
// after Create, adds the old cover's people to the new cover's Project Team (reported on
// the done page). See src/experimental/prefill-from-old-cover (also for how to remove it).
// Turn off before publishing.
const PREFILL_FROM_OLD_COVER = true;
// Only with PREFILL_FROM_OLD_COVER: shows a "Pre-fill debug" box on the form (what was read
// from the old cover, and what the form did with it), and a "Fill project team" box to
// run the team filling by hand, with its report in that box. Turn off before publishing.
const DEBUG_PREFILL = false;
// EXPERIMENTAL: prefill-from-old-cover (end)

async function sendDebug(extra: Record<string, unknown> = {}) {
  if (!DEBUG) return;
  figma.ui.postMessage({ type: 'debug', info: { ...(await contributorMemoryDebugInfo()), ...extra } });
}

// Matches the CSS `zoom` on :root in ui.html, so the window grows with the UI.
const UI_SCALE = 1.15;
const WIDTH = Math.round(360 * UI_SCALE);
// The window follows the content height, within these bounds (content scrolls beyond the max).
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const INITIAL_HEIGHT = 260;

/** The plugin window's distance from the top of the canvas area, in screen pixels. */
const TOP_OFFSET = 120;

/**
 * Where the plugin window opens: centered horizontally on the visible canvas,
 * TOP_OFFSET below its top edge. Its top-left corner, in canvas coordinates
 * (screen pixels are divided by the zoom).
 */
function launchPosition() {
  const { center, bounds, zoom } = figma.viewport;
  return { x: Math.round(center.x - WIDTH / 2 / zoom), y: Math.round(bounds.y + TOP_OFFSET / zoom) };
}

// Figma design files get the full plugin; FigJam gets only its own template
// ("editor": "figjam"), opened straight on the form, and no capture tool.
if (figma.editorType === 'figma' || figma.editorType === 'figjam') {
  const editor = figma.editorType;
  const capture = CAPTURE && editor === 'figma';
  const prefillFromOldCover = PREFILL_FROM_OLD_COVER && editor === 'figma'; // EXPERIMENTAL: prefill-from-old-cover

  // Only problems with the template set as a whole show on open. A single
  // template's problems show when Create is clicked for it (see createFile).
  const templateErrors = checkTemplates(editor);
  if (templateErrors.length) {
    console.error(templateErrors.join('\n'));
    figma.notify(templateErrors[0], { error: true, timeout: 10000 });
  }

  figma.showUI(__html__, {
    themeColors: true,
    title: editor === 'figjam' ? 'Insert thumbnail' : PLUGIN_NAME,
    width: WIDTH,
    height: INITIAL_HEIGHT,
    position: launchPosition(),
  });

  // Per template, the form fields it can't fill (see src/availability.ts).
  let unavailable: Record<FileType, FormField[]> = {};
  let watchingOldCover = false; // EXPERIMENTAL: prefill-from-old-cover (the UI is told about old covers already)
  let createdOnce = false; // EXPERIMENTAL: prefill-from-old-cover (no pre-filling from the old cover after Create)

  figma.ui.onmessage = async (msg: UIMessage) => {
    // The UI asks for its initial values once its script has loaded.
    if (msg.type === 'ready') {
      const contributors = await loadContributorName();
      figma.ui.postMessage({
        type: 'init',
        contributors,
        // The File type list and each template's form heading, thumbnail title label and fields.
        templates: templateSummaries(editor),
        editor, // "figjam": the UI skips the File type list and opens the form
        version: DISPLAY_VERSION, // shown next to the File type heading
        features: {
          capture,
          debug: DEBUG,
          projectTeamBox: prefillFromOldCover && DEBUG_PREFILL, // EXPERIMENTAL: prefill-from-old-cover
          debugPrefill: prefillFromOldCover && DEBUG_PREFILL, // EXPERIMENTAL: prefill-from-old-cover
        },
        // The UI animates the window height within these bounds.
        window: { min: MIN_HEIGHT, max: MAX_HEIGHT },
      });
      // EXPERIMENTAL: prefill-from-old-cover (start)
      // On open, and whenever that changes: whether the file has an "OLD Thumbnail"
      // section on its thumbnail page (the File type step then shows "Fill project
      // team"), and, until the first Create, the old cover's values to pre-fill the form
      // with (also from an old file Create hasn't cleaned up yet, and again when the
      // thumbnail page's layers change; the UI only fills fields the user hasn't edited).
      if (prefillFromOldCover && !watchingOldCover) {
        watchingOldCover = true;
        watchOldCover(async ({ found, foundChanged }) => {
          if (foundChanged) figma.ui.postMessage({ type: 'old-cover', found });
          if (createdOnce) return;
          const values = await readOldCoverValues(DEBUG_PREFILL).catch(() => ({}));
          figma.ui.postMessage({ type: 'old-cover-values', values });
        });
      }
      // EXPERIMENTAL: prefill-from-old-cover (end)
      await sendDebug({ prefill: contributors });
      // Afterwards, so loading the library components doesn't delay the form: which
      // fields each template can't fill (the form disables them).
      const fields = await unavailableFields(editor);
      if (fields === null) {
        // The library can't be reached: the form says so and disables Create.
        figma.ui.postMessage({ type: 'library-unavailable' });
        return;
      }
      unavailable = fields;
      if (Object.keys(unavailable).length) figma.ui.postMessage({ type: 'unavailable-fields', byTemplate: unavailable });
      return;
    }

    if (msg.type === 'capture-file' && capture) {
      try {
        const result = await captureFile();
        console.log(`Captured file as JSON. Warnings (${result.warnings.length}):\n${result.warnings.join('\n')}`);
        figma.ui.postMessage({ type: 'capture-result', result });
      } catch (error) {
        console.error(error);
        figma.ui.postMessage({ type: 'capture-result', error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // EXPERIMENTAL: prefill-from-old-cover (start)
    // Never stops the plugin; everything goes into the box's report.
    if (msg.type === 'fill-project-team' && prefillFromOldCover) {
      let lines: string[];
      try {
        lines = await fillProjectTeam();
      } catch (error) {
        console.error(error);
        lines = [`Couldn't fill the project team: ${error instanceof Error ? error.message : String(error)}`];
      }
      console.log(`Fill project team:\n${lines.join('\n')}`);
      figma.ui.postMessage({ type: 'project-team-result', lines });
      return;
    }
    // EXPERIMENTAL: prefill-from-old-cover (end)

    if (msg.type === 'debug-clear-contributor') {
      await clearContributorName();
      await sendDebug({ prefill: '', lastSave: 'Cleared' });
      return;
    }

    // The file name the form would get right now, from the same code Create uses.
    if (msg.type === 'debug-file-name' && DEBUG) {
      const template = findTemplate(msg.data.fileType);
      const fileName = template ? fileNameFor(template, msg.data) : '';
      figma.ui.postMessage({ type: 'debug-file-name', fileName });
      return;
    }

    if (msg.type === 'resize') {
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(msg.height)));
      figma.ui.resize(WIDTH, height);
      return;
    }

    if (msg.type === 'open-url') {
      figma.openExternal(msg.url);
      return;
    }

    if (msg.type === 'create-file') {
      createdOnce = true; // EXPERIMENTAL: prefill-from-old-cover
      const fail = (message: string) => {
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: 'create-failed' });
      };

      const data = sanitize(msg.data, unavailable[msg.data.fileType] ?? []);
      if (typeof data === 'string') return fail(data);

      // Saved on Create even if building the file fails afterwards.
      const saveResult = await saveContributorName(data.contributors);
      await sendDebug({ lastSave: saveResult });

      try {
        const { fileName, changed, skipped, warnings, cleanup, backedUp } = await createFile(data);
        if (cleanup.length) console.log(`Clean-up actions:\n${cleanup.join('\n')}`);
        if (warnings.length) console.warn(`Template warnings:\n${warnings.join('\n')}`);
        // The plugin stays open on the "created" screen, which lists the warnings (e.g.
        // skipped pages) and suggests the file name unless the file already has it
        // (Figma and FigJam alike).
        const named = figma.root.name.trim() === fileName;
        figma.ui.postMessage({ type: 'created', fileName: named ? null : fileName, changed, skipped, warnings, cleanup, backedUp });
        // EXPERIMENTAL: prefill-from-old-cover (start)
        // Then fills the new cover's Project Team from the old cover, without holding up
        // the done page; what it did is added to the done page (nothing if there was nothing to do).
        if (prefillFromOldCover) {
          fillProjectTeam({ auto: true })
            .then((lines) => {
              if (lines.length) figma.ui.postMessage({ type: 'project-team-auto', lines });
            })
            .catch((error) => console.warn("Couldn't fill the project team", error));
        }
        // EXPERIMENTAL: prefill-from-old-cover (end)
      } catch (error) {
        console.error(error);
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  };
}
