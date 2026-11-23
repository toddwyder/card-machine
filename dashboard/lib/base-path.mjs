// Mission control is served beside the Julia dashboard, so every address carries this prefix.
// next.config.mjs and the browser's own fetch both read it here.

export const BASE_PATH = '/control';
