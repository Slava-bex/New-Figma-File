// The new cover's library components that "Fill project team" works with
// (PREFILL_FROM_OLD_COVER in code.ts), found by key, so renaming them in the library is
// safe. Moving them to another library changes their keys: update them here.

import type { LibraryComponent } from '../../library';

/** "Figma Thumbnail / Project Info": the cover's project info, with the Project Team in it. */
export const PROJECT_INFO: LibraryComponent = {
  label: 'Figma Thumbnail / Project Info',
  key: '6f9c5dd8932c76f2c605ac4b8871ede80f2a2d10',
};

/** Older thumbnails' file type badge: its "App" variant is the product, e.g. "PMS" (component set). */
export const OLD_FILE_TYPE_BADGE: LibraryComponent = {
  label: '_Base Thumbnail File Type',
  key: '3171b74b946039ec6d3ea4f4bc2dcc135addcf67',
};

/**
 * A team in the Project Team: a "Team / …" component with a Colleagues slot holding
 * employee instances ("PM / Tom Groeneveld"), or the team's placeholder. The slot's
 * preferred values (set in the library) are the people the team offers.
 */
export interface Team extends LibraryComponent {
  /** How the cover's heading (and the report) names the team. */
  heading: string;
  /** The team's placeholder employee, e.g. "PM / Placeholder". */
  placeholderKey: string;
}

export const TEAMS: readonly Team[] = [
  {
    label: 'Team / Product Managers',
    heading: 'Product Managers',
    key: '83c3811292dc4c13caefcdbcc75d48a60adc7ee1',
    placeholderKey: '6591a9d0bd6d5361716525900717bee52aa63539',
  },
  {
    label: 'Team / Product Designers',
    heading: 'Product Designers',
    key: '8878b15a34ea39ca23e0023d3f705a1fdc33148b',
    placeholderKey: '734878622ec220ecc2f3b99db06b7e7dcc37f655',
  },
  {
    label: 'Team / Lead Dev',
    heading: 'Lead Development',
    key: '1ae54d3358f2a5706bb374d6ee1b37b09eb5c9bf',
    placeholderKey: 'f81e8eff9b7c7a4ad077283aa21de9586cd5d0b6',
  },
];

/** An employee component's person: "PM / Tom Groeneveld" → "Tom Groeneveld". */
export const employeeName = (componentName: string) => componentName.replace(/^[^/]*\/\s*/, '').trim();

/** Whether a component is one of the teams' placeholders ("PM / Placeholder", or another version of it). */
export const isPlaceholder = (component: ComponentNode) =>
  TEAMS.some((team) => team.placeholderKey === component.key) || employeeName(component.name).toLowerCase() === 'placeholder';
