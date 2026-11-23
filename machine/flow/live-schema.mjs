// The live log's one schema. The machine writes these lines and mission control
// reads them, so both sides import the type names and the field that carries them
// instead of each keeping its own copy of the vocabulary.

export const LIVE_TYPE_FIELD = 'type';

// Every kind of line the machine writes to a run's live file.
export const LIVE_TYPES = ['run', 'stage', 'agent', 'tool', 'model', 'tasks', 'outcome'];

const known = new Set(LIVE_TYPES);

/** The event's type, or undefined for a line this screen does not know. */
export const liveType = (event) => event?.[LIVE_TYPE_FIELD];

/** True when the value is one of the types the machine writes. */
export const isLiveType = (value) => known.has(value);
