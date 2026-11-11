// Code that fills placed library components with form data. templates/_shared.json
// refers to these by name ("fill": "thumbnail"). Mapping form data onto a
// component's layers is the one part that has to be code; add a new filler
// here when a new component needs data.

import type { NewFileData } from '../../types';
import { fillThumbnailTemplate } from './thumbnail';

export type Filler = (component: FrameNode, data: NewFileData) => Promise<void>;

export const FILLERS: Record<string, Filler> = {
  thumbnail: fillThumbnailTemplate,
};
