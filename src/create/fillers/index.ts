// Code that puts form data into library components. After placing a
// template's content, the plugin runs every filler on each placed item; a
// filler finds its components by id (see src/library.ts) and does nothing if
// they aren't there. Mapping form data onto a component's layers is the one
// part that has to be code; add a filler here when a new component needs data.

import type { NewFileData } from '../../types';
import { fillLinks } from './links';
import { fillThumbnail } from './thumbnail';

/** Fills what it recognizes in `root`; may return the frame to use as file thumbnail. */
export type Filler = (root: SceneNode, data: NewFileData) => Promise<{ thumbnail?: FrameNode }>;

export const FILLERS: Filler[] = [fillThumbnail, fillLinks];
