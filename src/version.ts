// The release number: `version` of package.json, which always matches the git tag of the release (see CLAUDE.md).
// Vite keeps only this field of the JSON in the bundle.
import { version } from '../package.json';

export const APP_VERSION: string = version;
