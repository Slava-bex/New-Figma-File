import { cleanText, LIMITS } from './sanitize';

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

export async function loadContributorName(): Promise<string> {
  try {
    const stored = await figma.clientStorage.getAsync(CONTRIBUTOR_NAME_KEY);
    return typeof stored === 'string' ? cleanText(stored, LIMITS.contributors) : '';
  } catch {
    return '';
  }
}

/** Saves the user's own name from `contributors`, and says what happened (for the debug panel). */
export async function saveContributorName(contributors: string | undefined): Promise<string> {
  const user = figma.currentUser?.name;
  if (!user) return 'Not saved: Figma gave no current user name';
  const ownName = findOwnName(contributors);
  // Keep whatever was remembered before.
  if (!ownName) return `Not saved: no entry in "${contributors ?? ''}" matches the start of "${user}"`;
  try {
    await figma.clientStorage.setAsync(CONTRIBUTOR_NAME_KEY, ownName);
    return `Saved "${ownName}"`;
  } catch (error) {
    console.warn('Could not save contributor name', error);
    return `Not saved: clientStorage failed (${error})`;
  }
}

/** Raw state for the debug panel. */
export async function contributorMemoryDebugInfo() {
  let stored: unknown;
  try {
    stored = await figma.clientStorage.getAsync(CONTRIBUTOR_NAME_KEY);
  } catch (error) {
    stored = `<read failed: ${error}>`;
  }
  return { user: figma.currentUser?.name ?? null, stored: stored ?? null };
}

export async function clearContributorName() {
  await figma.clientStorage.deleteAsync(CONTRIBUTOR_NAME_KEY);
}
