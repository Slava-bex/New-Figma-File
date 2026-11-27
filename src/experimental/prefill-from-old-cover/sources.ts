// Where "Fill project team" finds an old cover's people, on the thumbnail page:
// - an old Project Info (e.g. a cover from an earlier run): the employees in its teams,
// - an old thumbnail's contributors text: the text next to a "deelnemers" or
//   "contributors" label (e.g. "Tom, Mustafa"), whatever its layers are called, so
//   older thumbnail versions work too.
// The old cover is what's in "OLD Thumbnail" sections, or without one, everything on
// the page outside the new cover. Hidden layers don't count (e.g. older teams'
// switched-off 2nd and 3rd colleagues).

import { findInstances, type LibraryComponent } from '../../library';
import { nameForMatching, namesMatch } from '../../name-matching';
import { isOldThumbnailSection } from '../../thumbnail-page';
import { employeeName, isPlaceholder, type Team } from './components';
import { samePerson } from './match-people';

/** The labels of an old thumbnail's contributors text. */
const CONTRIBUTORS_LABELS = ['deelnemers', 'contributors'];

/** The old cover's top-level layers on `page` (see above). */
export function oldCover(page: PageNode, newCover: SceneNode): SceneNode[] {
  const sections = page.children.filter(isOldThumbnailSection);
  return sections.length ? sections : page.children.filter((node) => node.id !== newCover.id);
}

/** Whether `node` shows, up to `root`: it and the layers around it aren't hidden. */
export function isVisibleWithin(node: SceneNode, root: BaseNode): boolean {
  for (let current: BaseNode | null = node; current && current.id !== root.id; current = current.parent) {
    if ('visible' in current && !current.visible) return false;
  }
  return true;
}

/** An employee in an old team. */
export interface OldMember {
  instance: InstanceNode;
  component: ComponentNode;
  /** "PM / Tom Groeneveld" → "Tom Groeneveld". */
  fullName: string;
}

/** The (visible) employees in the old cover's instances of `team`, in order, each person once (placeholders left out). */
export async function oldTeamMembers(roots: readonly SceneNode[], team: Team): Promise<OldMember[]> {
  const members: OldMember[] = [];
  for (const root of roots) {
    for (const oldTeam of await findByKeyOrName(root, team)) {
      if (!isVisibleWithin(oldTeam, root)) continue;
      for (const instance of oldTeam.findAllWithCriteria({ types: ['INSTANCE'] })) {
        if (!isVisibleWithin(instance, oldTeam)) continue;
        const component = await instance.getMainComponentAsync();
        // Employees are components named "<ROLE> / <Full Name>" (not variants, like icons).
        if (!component || component.parent?.type === 'COMPONENT_SET' || !/^\s*[A-Z]+\s*\//.test(component.name)) continue;
        if (isPlaceholder(component)) continue;
        const fullName = employeeName(component.name);
        const known = members.some((m) => m.component.key === component.key || samePerson(m.fullName, fullName));
        if (!known) members.push({ instance, component, fullName });
      }
    }
  }
  return members;
}

/** `component`'s instances in `root`: by key, or for another version of it (another key), by name. */
export async function findByKeyOrName(root: SceneNode, component: LibraryComponent): Promise<InstanceNode[]> {
  const byKey = await findInstances(root, component);
  if (byKey.length) return byKey;
  const instances = [root, ...('findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : [])];
  return instances.filter((node): node is InstanceNode => node.type === 'INSTANCE' && namesMatch(node.name, component.label));
}

const INLINE_LABEL = new RegExp(`^\\s*(?:${CONTRIBUTORS_LABELS.join('|')})\\s*:\\s*(.+)$`, 'is');

/**
 * The old cover's (visible) contributors texts: the texts next to a "deelnemers" or
 * "contributors" label (in the same layer), or after one in the same text
 * ("deelnemers: Tom, Mustafa"). Each text once.
 */
export function contributorsTexts(roots: readonly SceneNode[]): string[] {
  const texts = new Set<string>();
  for (const root of roots) {
    const all = root.type === 'TEXT' ? [root] : 'findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['TEXT'] }) : [];
    for (const text of all) {
      if (!isVisibleWithin(text, root)) continue;
      const inline = INLINE_LABEL.exec(text.characters);
      if (inline) texts.add(inline[1].trim());
      if (!CONTRIBUTORS_LABELS.includes(nameForMatching(text.characters))) continue;
      // By id: inside instances, the parent's children are new objects for the same layers.
      for (const sibling of text.parent?.children ?? []) {
        if (sibling.id === text.id || sibling.type !== 'TEXT' || !sibling.visible || !sibling.characters.trim()) continue;
        texts.add(sibling.characters.trim());
      }
    }
  }
  return [...texts];
}
