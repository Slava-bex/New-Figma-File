// Plugin entry point: opens the UI and handles its messages.
// What "Create file" builds is defined per template in templates/ (see templates/README.md).

import { captureFile } from './src/capture';
import {
  clearContributorName,
  contributorMemoryDebugInfo,
  loadContributorName,
  saveContributorName,
} from './src/contributor-memory';
import { createFile } from './src/create';
import { sanitize } from './src/sanitize';
import { fileNameFor } from './src/placeholders';
import { checkTemplates, findTemplate, templateSummaries } from './src/templates';
import type { NewFileData } from './src/types';
import { DISPLAY_VERSION } from './src/version';

type UIMessage =
  | { type: 'ready' }
  | { type: 'create-file'; data: NewFileData }
  | { type: 'open-url'; url: string }
  | { type: 'resize'; height: number }
  | { type: 'debug-clear-contributor' }
  | { type: 'debug-file-name'; data: NewFileData }
  | { type: 'capture-file' };

// Shows a "Capture this file as JSON" tool on the File type step: turns the
// open file into a template file for templates/ (see templates/README.md).
// For building templates only; turn off before publishing.
const CAPTURE = true;

// Shows a debug panel under the form: a preview of the suggested file name, and
// (for templates with a Contributors field) the remembered contributor name:
// what's stored, what was pre-filled, and what happened on Create.
// Turn off before publishing.
const DEBUG = true;

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

if (figma.editorType === 'figma') {
  // Catch mistakes in templates/*.json as soon as the plugin opens.
  const templateErrors = checkTemplates();
  if (templateErrors.length) {
    console.error('templates/ has problems:\n' + templateErrors.join('\n'));
    figma.notify(`templates/${templateErrors[0]}`, { error: true, timeout: 10000 });
  }

  figma.showUI(__html__, {
    themeColors: true,
    title: 'New file',
    width: WIDTH,
    height: 260,
  });

  figma.ui.onmessage = async (msg: UIMessage) => {
    // The UI asks for its initial values once its script has loaded.
    if (msg.type === 'ready') {
      const contributors = await loadContributorName();
      figma.ui.postMessage({
        type: 'init',
        contributors,
        // The File type list and each template's form heading, thumbnail title label and fields.
        templates: templateSummaries(),
        version: DISPLAY_VERSION, // shown next to the File type heading
        features: { capture: CAPTURE, debug: DEBUG },
        // The UI animates the window height within these bounds.
        window: { min: MIN_HEIGHT, max: MAX_HEIGHT },
      });
      await sendDebug({ prefill: contributors });
      return;
    }

    if (msg.type === 'capture-file' && CAPTURE) {
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
      const fail = (message: string) => {
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: 'create-failed' });
      };

      const data = sanitize(msg.data);
      if (typeof data === 'string') return fail(data);

      // Saved on Create even if building the file fails afterwards.
      const saveResult = await saveContributorName(data.contributors);
      await sendDebug({ lastSave: saveResult });

      try {
        const { fileName } = await createFile(data);
        // The plugin stays open on the "created" screen, which suggests the file name
        // unless the file already has it.
        const named = figma.root.name.trim() === fileName;
        figma.ui.postMessage({ type: 'created', fileName: named ? null : fileName });
      } catch (error) {
        console.error(error);
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
  };
}
