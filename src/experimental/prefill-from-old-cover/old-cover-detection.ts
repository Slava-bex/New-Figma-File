// Whether the file has an old cover to fill the project team from: an "OLD Thumbnail"
// section on a thumbnail page (both recognised as in src/thumbnail-page.ts). The File
// type step shows the "Fill project team" box only then, kept up to date while the
// plugin is open (code.ts passes the changes on to the UI). Changes to the thumbnail
// pages' layers are passed on too, so the form's pre-fill follows an old cover that's
// placed or removed while the plugin is open.

import { isOldThumbnailSection, thumbnailPages } from '../../thumbnail-page';

/** The first thumbnail page with an "OLD Thumbnail" section (loading the thumbnail pages to look), or null. */
export async function thumbnailPageWithOldCover(): Promise<PageNode | null> {
  for (const page of thumbnailPages()) {
    await page.loadAsync();
    if (page.children.some(isOldThumbnailSection)) return page;
  }
  return null;
}

/** What `watchOldCover` reports. */
export interface OldCoverChange {
  /** Whether a thumbnail page has an "OLD Thumbnail" section. */
  found: boolean;
  /** Whether `found` changed (always true the first time); otherwise only the thumbnail pages' layers did. */
  foundChanged: boolean;
}

/**
 * Calls `onChange` right away, and again each time, while the plugin is open, whether
 * the file has an old cover changes, or the thumbnail pages' top-level layers do (added,
 * removed or renamed). Checks again when something changes on a thumbnail page, and when
 * the user switches pages (e.g. after renaming one to "Thumbnail"). A check only looks
 * at the thumbnail pages' top-level layers.
 * Returns a function that stops watching (the plugin itself watches until it closes).
 */
export function watchOldCover(onChange: (change: OldCoverChange) => void): () => void {
  // The thumbnail pages listened to, by id.
  const watched = new Map<string, PageNode>();
  let found: boolean | null = null;
  // The thumbnail pages' top-level layers at the last report.
  let layers = '';
  let checking = false;
  let again = false;
  let stopped = false;

  async function check() {
    if (stopped) return;
    // Thumbnail pages may have been renamed, added or removed: listen to the current ones.
    const pages = thumbnailPages();
    for (const [id, page] of watched) {
      if (pages.some((p) => p.id === id)) continue;
      if (!page.removed) page.off('nodechange', recheck);
      watched.delete(id);
    }
    for (const page of pages) {
      if (watched.has(page.id)) continue;
      await page.loadAsync();
      if (stopped) return;
      page.on('nodechange', recheck);
      watched.set(page.id, page);
    }
    const now = pages.some((page) => page.children.some(isOldThumbnailSection));
    const nowLayers = pages.map((page) => `${page.id}:${page.children.map((node) => `${node.id}=${node.name}`).join(',')}`).join('|');
    if (stopped || (now === found && nowLayers === layers)) return;
    const foundChanged = now !== found;
    found = now;
    layers = nowLayers;
    onChange({ found: now, foundChanged });
  }

  // One check at a time; changes during a check get one more check after it.
  function recheck() {
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    check()
      .catch((error) => console.warn("Couldn't check for an old cover", error))
      .finally(() => {
        checking = false;
        if (again) {
          again = false;
          recheck();
        }
      });
  }

  figma.on('currentpagechange', recheck);
  recheck();
  return () => {
    stopped = true;
    figma.off('currentpagechange', recheck);
    for (const page of watched.values()) if (!page.removed) page.off('nodechange', recheck);
    watched.clear();
  };
}
