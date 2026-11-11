/** Id of a file template: its file name in templates/, e.g. "project-discovery". */
export type FileType = string;

/** Form fields a template can show besides the name (its "fields" in templates/<id>.json). */
export const FORM_FIELDS = ['description', 'contributors', 'githubIssueUrl', 'products', 'externalAccess'] as const;
export type FormField = (typeof FORM_FIELDS)[number];

// What the UI collects. Optional fields are only present when the chosen
// template shows them.
export interface NewFileData {
  fileType: FileType;
  name: string;
  description?: string;
  contributors?: string;
  githubIssueUrl?: string; // "" or https://github.com/<owner>/<repo>/issues/<number>
  products?: string[];
  externallyAccessible: boolean;
}
