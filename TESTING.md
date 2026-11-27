# Test checklist

Run through this before publishing, and after bigger changes. Use copies of real files, never the originals.

**Setup:** run `npm run build` (it must pass), then reload the plugin in Figma (Plugins › Development).

## 1. New Figma design file

- [ ] Each template creates its pages in order, with dividers and subpages in the right place.
- [ ] The thumbnail shows the title, description (shown only when filled in), contributors, product and data protection from the form.
- [ ] Products: one known product, "Other" with a name, and several products (shows the names together). With no product selected, the pill is hidden.
- [ ] A GitHub issue URL fills the cover's GitHub link (label, `repo#number`, clickable).
- [ ] The file thumbnail is set (check the file browser).
- [ ] The run ends on the thumbnail page, zoomed to fit everything with space around it, not on a divider.
- [ ] Done page: "File structure created." without a backup line (the file was empty), and the suggested file name with a working Copy button.

## 2. Re-run on the same file

- [ ] Shows "No changes applied.", lists the skipped pages, and offers **Re-create file structure**.
- [ ] No clean-up actions: no divider or "Moved" lines.
- [ ] Delete one page, click **Re-create file structure**: only that page comes back.
- [ ] The thumbnail page isn't wrapped into an "OLD Thumbnail" section again.
- [ ] Delete the new cover, keeping only the "OLD Thumbnail" section, and re-run: a new cover is placed to the left of the section, without a second wrap.

## 3. Old file clean-up

- [ ] Pages with similar names (different capitals, emojis or spacing) are renamed, not duplicated.
- [ ] Existing dividers are reused; extra ones are removed ("Removed N extra dividers").
- [ ] Pages the template doesn't use end up before the first divider after the main design page.
- [ ] Subpages (names starting with 2+ spaces) stay under their parent, in order, with their own spacing ("Moved 'Archive' (with N subpages)").
- [ ] Orphan subpages (right after a divider) lose their leading spaces and become normal pages ("Removed leading spaces from 'X'").
- [ ] An empty reused page gets the template's content and background.
- [ ] An old "Thumbnail" or "Cover" page: its old content moves into an "OLD Thumbnail" section to the right of the new cover.
- [ ] Old pages with fonts the plugin doesn't load (e.g. Caecilia LT Pro in Guest Portal): the run completes and the pages end up in template order. Anything Figma refuses to move is listed in clean-up ("Couldn't move…", "Kept old content…").
- [ ] No content is lost anywhere.
- [ ] Version history has "Before file structure change", with the plugin name and version in the description. Restoring it brings the file back as it was.
- [ ] The success message ends with "Backup stored in Version history."

## 4. FigJam

- [ ] Fresh board: opens straight on the form, with "Insert thumbnail" and the version link next to the heading.
- [ ] Creates the template's pages; "Page 1" becomes the title page.
- [ ] Done page shows the "Set as thumbnail" reminder, animated once, and "Suggested file name".
- [ ] Board that already has its own pages: no extra title page, and no message about it.

## 5. Problems and environment

- [ ] Library not enabled for the file (or offline): the form shows "Can't reach the Figma library…" and Create stays disabled.
- [ ] A template with a broken page (e.g. an empty page name) stops `npm run build` with a clear error.
- [ ] A thumbnail component that can't be loaded (e.g. a key that doesn't exist) shows an error and leaves the file exactly as it was.
- [ ] Any other component that can't be loaded (e.g. the Change log) is skipped: everything else is created, with a "Couldn't insert a component on …" warning.
- [ ] When the library changes: a field whose target layer is gone is disabled, with the tooltip, and Create still works.

## 6. Interface

- [ ] A long form keeps the Create button at the bottom, fading the content above it until you scroll to the end.
- [ ] The window opens centered horizontally, 120 px from the top.
- [ ] Version link: shows its tooltip quickly, turns the brand color on hover, and opens GitHub.
- [ ] The back button on the done page returns to the form with the values kept.
- [ ] Looks right in both light and dark theme.

## Before publishing

- [ ] `CAPTURE = false` and `DEBUG = false` in `code.ts`.
- [ ] `PREFILL_FROM_OLD_COVER = false` and `DEBUG_PREFILL = false` in `code.ts`. <!-- EXPERIMENTAL: prefill-from-old-cover -->
- [ ] `npm run build` passes.
