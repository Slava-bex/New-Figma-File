// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

type FileType = 'blank' | 'project-discovery' | 'project-hand-off' | 'living-feature-file';

// Fields are only present when the UI shows them for the chosen file type:
//   blank:               name (Title), description, contributors
//   project-discovery:   name (Project name), contributors, githubIssue, products
//   project-hand-off:    name (Project name), contributors, githubIssue, products
//   living-feature-file: name (Feature name), contributors, products
interface NewFileData {
  fileType: FileType;
  name: string;
  description?: string;
  contributors?: string;
  githubIssue?: string;
  products?: string[];
  externallyAccessible: boolean;
}

// Same constraints as the UI (Figma: "Input validation & constraints"). The UI
// already enforces them; this is a safety net so the plugin never acts on bad data.
const LIMITS = { name: { min: 3, max: 80 }, description: 120, contributors: 60, product: 30, githubIssue: 6 };
const FILE_TYPES: FileType[] = ['blank', 'project-discovery', 'project-hand-off', 'living-feature-file'];

const cleanText = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function cleanGithubIssue(value: unknown) {
  let text = String(value ?? '').trim();
  const fromUrl = text.match(/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/(\d+)/i);
  if (fromUrl) text = fromUrl[1];
  return text.replace(/^#+/, '').replace(/\D/g, '').slice(0, LIMITS.githubIssue);
}

// Returns sanitized data, or an error message if it can't be used.
function sanitize(data: NewFileData): NewFileData | string {
  if (!FILE_TYPES.includes(data.fileType)) return 'Unknown file type';
  const name = cleanText(data.name, LIMITS.name.max);
  if (name.length < LIMITS.name.min) return `Name needs at least ${LIMITS.name.min} characters`;

  const clean: NewFileData = {
    fileType: data.fileType,
    name,
    externallyAccessible: data.externallyAccessible === true,
  };
  if (data.description !== undefined) clean.description = cleanText(data.description, LIMITS.description);
  if (data.contributors !== undefined) clean.contributors = cleanText(data.contributors, LIMITS.contributors);
  if (data.githubIssue !== undefined) clean.githubIssue = cleanGithubIssue(data.githubIssue);
  if (Array.isArray(data.products)) {
    clean.products = data.products.map((product) => cleanText(product, LIMITS.product)).filter(Boolean);
  }
  return clean;
}

// ---- Remembered contributor name ----
// When the Contributors list includes the current user's own name, or the
// first part of it ("Slava" for "Slava Bronevitskiy"), that entry is saved
// on Create and pre-filled on the next launch. Stored per user via clientStorage.
const CONTRIBUTOR_NAME_KEY = 'contributorName';

function findOwnName(contributors: string | undefined): string | null {
  const fullName = figma.currentUser?.name?.trim().toLowerCase();
  if (!fullName || !contributors) return null;
  for (const entry of contributors.split(',').map((part) => part.trim()).filter(Boolean)) {
    const candidate = entry.toLowerCase();
    // Must match the start of the full name on a word boundary ("Sla" doesn't count).
    if (fullName === candidate || fullName.startsWith(`${candidate} `)) return entry;
  }
  return null;
}

async function loadContributorName(): Promise<string> {
  try {
    const stored = await figma.clientStorage.getAsync(CONTRIBUTOR_NAME_KEY);
    return typeof stored === 'string' ? cleanText(stored, LIMITS.contributors) : '';
  } catch {
    return '';
  }
}

async function saveContributorName(contributors: string | undefined) {
  const ownName = findOwnName(contributors);
  if (!ownName) return; // Keep whatever was remembered before.
  try {
    await figma.clientStorage.setAsync(CONTRIBUTOR_NAME_KEY, ownName);
  } catch (error) {
    console.warn('Could not save contributor name', error);
  }
}

type UIMessage =
  | { type: 'ready' }
  | { type: 'create-file'; data: NewFileData }
  | { type: 'open-url'; url: string }
  | { type: 'resize'; height: number };

// Matches the CSS `zoom` on :root in ui.html, so the window grows with the UI.
const UI_SCALE = 1.15;
const WIDTH = Math.round(360 * UI_SCALE);
// The window follows the content height, within these bounds (content scrolls beyond the max).
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

if (figma.editorType === 'figma') {
  figma.showUI(__html__, {
    themeColors: true,
    title: 'New file',
    width: WIDTH,
    height: 260,
  });

  figma.ui.onmessage = async (msg: UIMessage) => {
    // The UI asks for its initial values once its script has loaded.
    if (msg.type === 'ready') {
      figma.ui.postMessage({
        type: 'init',
        contributors: await loadContributorName(),
        // The UI animates the window height within these bounds.
        window: { min: MIN_HEIGHT, max: MAX_HEIGHT },
      });
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
      const data = sanitize(msg.data);
      if (typeof data === 'string') {
        figma.notify(data, { error: true });
        return;
      }

      // Must finish before closePlugin(), which would cancel it.
      await saveContributorName(data.contributors);

      // TODO: build the file from data (thumbnail, pages, etc.).
      console.log('Create file', data);
      figma.closePlugin(`Created "${data.name}"`);
    }
  };
}
