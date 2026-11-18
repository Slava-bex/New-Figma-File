// Which form fields a template can actually fill, checked on the published library
// components when the plugin opens. Fields it can't fill are disabled in the form
// (with the reason as a tooltip) and left out on Create, instead of failing it:
// - description, contributors, data protection: the thumbnail's properties,
// - products: the product pill inside the thumbnail,
// - GitHub issue URL: a GitHub link in the template's own components (e.g. its cover).

import { hasGithubLink, missingThumbnailFields, withLibraryTimeout } from './library';
import { fieldsOf, isComponent, templatesFor, type ContentItem, type TemplateEditor } from './templates';
import type { FileType, FormField } from './types';

/**
 * For each template of the editor, the fields it shows but can't fill. null when
 * the library's thumbnail can't be loaded at all (no access, offline): then nothing
 * can be created, and the form says so.
 */
export async function unavailableFields(editor: TemplateEditor): Promise<Record<FileType, FormField[]> | null> {
  const thumbnailMissing = await missingThumbnailFields();
  if (thumbnailMissing === null) return null;
  const result: Record<FileType, FormField[]> = {};
  for (const template of templatesFor(editor)) {
    const fields = fieldsOf(template);
    const missing: FormField[] = fields.filter((field) => (thumbnailMissing as FormField[]).includes(field));
    if (fields.includes('githubIssueUrl') && !(await placesGithubLink(template.pages.flatMap((p) => p.content ?? [])))) {
      missing.push('githubIssueUrl');
    }
    if (missing.length) result[template.id] = missing;
  }
  return result;
}

/**
 * Whether any of the template's components contains a GitHub link. A component that
 * can't be loaded counts as having one: then nothing is disabled, and Create reports
 * the problem.
 */
async function placesGithubLink(items: ContentItem[]): Promise<boolean> {
  for (const item of items) {
    if (isComponent(item)) {
      let component: ComponentNode;
      try {
        component = await withLibraryTimeout(figma.importComponentByKeyAsync(item.component));
      } catch {
        return true;
      }
      if (await hasGithubLink(component)) return true;
    } else if (await placesGithubLink(item.children ?? [])) {
      return true;
    }
  }
  return false;
}
