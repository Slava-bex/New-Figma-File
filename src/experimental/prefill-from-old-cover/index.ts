// Experimental (PREFILL_FROM_OLD_COVER in code.ts), for files whose old cover is in an "OLD
// Thumbnail" section on the thumbnail page, as Create leaves them after cleaning up:
// - "Fill project team" (this file): adds the old cover's people to the new cover's
//   Project Team. A box on the done page, and on the File type step while the file
//   has an old cover (old-cover-detection.ts).
// - Pre-filling the form with the old cover's title, contributors, product and GitHub
//   issue link (old-cover-values.ts), also for old files Create hasn't cleaned up yet.
//
// Per team, the people come from an old Project Info if there is one (it wins), or
// else from an old thumbnail's contributors text (see sources.ts, match-people.ts).
// Missing people are added; the first one takes the placeholder's place.
//
// Old covers vary, so it does what it can and reports the rest, one line each; a value
// it can't pre-fill is left out without a warning. Only code.ts uses this folder.
//
// To remove the feature (once old files are cleaned up): delete this folder, and in
// code.ts, ui.html and TESTING.md (search for "EXPERIMENTAL: prefill-from-old-cover") delete each
// block from its "(start)" to its "(end)" marker line, and each other marked line. Then
// run `npm run build`. (src/thumbnail-page.ts stays: Create uses it.)

import { findInstances, THUMBNAIL, withLibraryTimeout } from '../../library';
import { isOldThumbnailSection, thumbnailPages } from '../../thumbnail-page';
import { employeeName, isPlaceholder, PROJECT_INFO, TEAMS, type Team } from './components';
import { matchPerson, samePerson, splitNames, type Person } from './match-people';
import { thumbnailPageWithOldCover } from './old-cover-detection';
import { contributorsTexts, oldCover, oldTeamMembers, type OldMember } from './sources';

export { watchOldCover } from './old-cover-detection';
export { readOldCoverValues } from './old-cover-values';

/** Someone a team's Colleagues slot offers (its preferred values). */
interface Offered extends Person {
  component: ComponentNode;
}

/** A team in the new cover, to fill. */
interface TargetTeam {
  team: Team;
  slot: SlotNode;
  offered: Offered[];
}

/** Someone to add: the latest version of their component, or else a copy of their old instance. */
interface Addition extends Person {
  key: string;
  component: ComponentNode | null;
  oldInstance?: InstanceNode;
}

/**
 * Fills the new cover's Project Team. Returns what happened, one line each.
 * `auto`: run by itself after Create, so it stays quiet (no lines) when there's nothing
 * to do: no thumbnail page or Project Info (e.g. the Blank template), or no people found.
 */
export async function fillProjectTeam({ auto = false } = {}): Promise<string[]> {
  const report: string[] = [];
  // The thumbnail page with the old cover, or else the first thumbnail page.
  const page = (await thumbnailPageWithOldCover()) ?? thumbnailPages()[0];
  if (!page) return auto ? [] : ["Couldn't find the thumbnail page (a page named 'Thumbnail' or 'Cover')"];
  await page.loadAsync();

  const projectInfo = await newProjectInfo(page);
  if (typeof projectInfo === 'string') return auto ? [] : [projectInfo];
  const old = oldCover(page, topLevelOf(projectInfo));

  const targets: TargetTeam[] = [];
  for (const team of TEAMS) {
    try {
      const target = await targetTeam(projectInfo, team, report);
      if (target) targets.push(target);
    } catch (error) {
      report.push(`Couldn't fill '${team.heading}': ${messageOf(error)}`);
    }
  }

  // The contributors text's names, matched once among everyone the teams offer.
  const texts = contributorsTexts(old);
  if (texts.length && !auto) report.push(`Old contributors: ${texts.join(' | ')}`);
  const everyone = targets.flatMap((target) => target.offered).filter((person, index, all) => all.findIndex((p) => samePerson(p.fullName, person.fullName)) === index);
  const matched: Offered[] = [];
  const problems: string[] = [];
  for (const name of [...new Set(texts.flatMap(splitNames))]) {
    const match = matchPerson(name, everyone);
    if ('person' in match) matched.push(match.person);
    else problems.push(match.problem);
  }

  let foundAnyone = matched.length > 0;
  for (const target of targets) {
    try {
      // An old Project Info wins; otherwise the matched contributors this team offers.
      const members = await oldTeamMembers(old, target.team);
      if (members.length) foundAnyone = true;
      const additions = members.length
        ? await Promise.all(members.map(fromOldMember))
        : matched.flatMap((person) => target.offered.filter((o) => samePerson(o.fullName, person.fullName)).slice(0, 1).map(fromOffered));
      const line = await addToTeam(target, additions, problems);
      if (line) report.push(line);
    } catch (error) {
      report.push(`Couldn't fill '${target.team.heading}': ${messageOf(error)}`);
    }
  }
  if (!foundAnyone && problems.length === 0) {
    if (auto) return [];
    report.push('Found no project team or contributors in the old cover');
  }
  return [...report, ...problems];
}

/** The new cover's Project Info: the one outside "OLD Thumbnail" sections (or the one next to the current thumbnail). */
async function newProjectInfo(page: PageNode): Promise<InstanceNode | string> {
  const found: InstanceNode[] = [];
  for (const node of page.children) found.push(...(await findInstances(node, PROJECT_INFO)));
  const candidates = found.filter((info) => !hasAncestor(info, isOldThumbnailSection));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return `Couldn't find the new cover's Project Info on '${page.name.trim()}'`;
  const withThumbnail: InstanceNode[] = [];
  for (const info of candidates) {
    if ((await findInstances(topLevelOf(info), THUMBNAIL)).length) withThumbnail.push(info);
  }
  return withThumbnail.length === 1 ? withThumbnail[0] : "Couldn't tell which Project Info is the new cover's";
}

/** `team` in the new Project Info, with its slot and the people it offers. Reports why not, if it can't be filled. */
async function targetTeam(projectInfo: InstanceNode, team: Team, report: string[]): Promise<TargetTeam | null> {
  const [instance] = await findInstances(projectInfo, team);
  if (!instance) {
    report.push(`Couldn't find '${team.heading}' in the new cover`);
    return null;
  }
  const slot = instance.findAllWithCriteria({ types: ['SLOT'] })[0];
  if (!slot) {
    report.push(`Couldn't fill '${team.heading}': it has no Colleagues slot`);
    return null;
  }
  const offered = await offeredPeople(instance, team);
  if (offered.length === 0) {
    report.push(`Couldn't match names to '${team.heading}': its Colleagues slot has no preferred people set in the library`);
  }
  return { team, slot, offered };
}

/** The people `team`'s Colleagues slot offers: its preferred values, without the placeholder. */
async function offeredPeople(instance: InstanceNode, team: Team): Promise<Offered[]> {
  const main = await instance.getMainComponentAsync();
  if (!main) return [];
  const owner = main.parent?.type === 'COMPONENT_SET' ? main.parent : main;
  const slotProperty = Object.values(owner.componentPropertyDefinitions).find((definition) => definition.type === 'SLOT');
  const values = (slotProperty?.preferredValues ?? []).filter((value) => value.key !== team.placeholderKey);
  const components = await Promise.all(
    values.map(async (value) => {
      try {
        if (value.type === 'COMPONENT') return await withLibraryTimeout(figma.importComponentByKeyAsync(value.key));
        const set = await withLibraryTimeout(figma.importComponentSetByKeyAsync(value.key));
        return set.defaultVariant;
      } catch {
        return null; // someone who can't be loaded isn't offered
      }
    }),
  );
  return components.flatMap((component) =>
    component && !isPlaceholder(component) ? [{ fullName: employeeName(component.parent?.type === 'COMPONENT_SET' ? component.parent.name : component.name), component }] : [],
  );
}

const fromOffered = (person: Offered): Addition => ({ fullName: person.fullName, key: person.component.key, component: person.component });

/** An old member, as the latest version of their component (the library update), or else a copy of the old instance. */
async function fromOldMember(member: OldMember): Promise<Addition> {
  const { component, fullName, instance } = member;
  if (!component.remote) return { fullName, key: component.key, component };
  try {
    return { fullName, key: component.key, component: await withLibraryTimeout(figma.importComponentByKeyAsync(component.key)) };
  } catch {
    return { fullName, key: component.key, component: null, oldInstance: instance };
  }
}

/**
 * Adds the people in `additions` the team doesn't have yet, in order: the first takes
 * the placeholder's place, the others go after the team's people. Returns the report
 * line; people who couldn't be added go to `problems`.
 */
async function addToTeam(target: TargetTeam, additions: Addition[], problems: string[]): Promise<string | null> {
  if (additions.length === 0) return null;
  const { slot, team } = target;
  const present = await Promise.all(slot.children.map(async (node) => (node.type === 'INSTANCE' ? await node.getMainComponentAsync() : null)));
  const has = (addition: Addition) =>
    present.some((component) => component && (component.key === addition.key || samePerson(employeeName(component.name), addition.fullName)));
  const missing = additions.filter((addition) => !has(addition));
  if (missing.length === 0) return `${team.heading}: everyone's already there`;

  const placeholderIndex = present.findIndex((component) => component?.key === team.placeholderKey);
  let placeholder = placeholderIndex === -1 ? null : (slot.children[placeholderIndex] as InstanceNode);
  const added: string[] = [];
  for (const addition of missing) {
    try {
      if (addition.component) {
        await loadFontsOf(addition.component);
        if (placeholder) {
          placeholder.swapComponent(addition.component);
          placeholder = null;
        } else {
          slot.appendChild(addition.component.createInstance());
        }
      } else if (addition.oldInstance) {
        await loadFontsOf(addition.oldInstance);
        const copy = addition.oldInstance.clone();
        try {
          if (placeholder) {
            const placeholderId = placeholder.id;
            slot.insertChild(slot.children.findIndex((node) => node.id === placeholderId), copy);
            placeholder.remove();
            placeholder = null;
          } else {
            slot.appendChild(copy);
          }
        } catch (error) {
          copy.remove();
          throw error;
        }
      }
      added.push(addition.fullName);
    } catch (error) {
      problems.push(`Couldn't add ${addition.fullName} to '${team.heading}': ${messageOf(error)}`);
    }
  }
  return added.length ? `${team.heading}: added ${added.join(', ')}` : null;
}

/** Loads the fonts of a component or instance's texts, so it can be placed (fonts that can't load are skipped). */
async function loadFontsOf(node: ComponentNode | InstanceNode) {
  const fonts = new Map<string, FontName>();
  for (const text of node.findAllWithCriteria({ types: ['TEXT'] })) {
    const names = typeof text.fontName === 'symbol' ? text.getRangeAllFontNames(0, text.characters.length) : [text.fontName];
    for (const font of names) fonts.set(`${font.family}\n${font.style}`, font);
  }
  await Promise.allSettled([...fonts.values()].map((font) => figma.loadFontAsync(font)));
}

/** The layer on the page that `node` is in, e.g. the cover frame around a Project Info. */
function topLevelOf(node: SceneNode): SceneNode {
  let current: SceneNode = node;
  while (current.parent && current.parent.type !== 'PAGE' && current.parent.type !== 'DOCUMENT') current = current.parent;
  return current;
}

function hasAncestor(node: BaseNode, test: (node: BaseNode) => boolean): boolean {
  for (let current = node.parent; current; current = current.parent) if (test(current)) return true;
  return false;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
