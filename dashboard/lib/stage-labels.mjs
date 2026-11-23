// The machine's stages, named the way the Run view shows them: the brief's plain English
// where a machine stage matches one of its steps, a readable fallback where it does not.
// The ids are createStages' own ids in machine/flow/steps.mjs. A stage id with no entry here
// fails stage-labels.test.mjs, so a new machine stage cannot reach the screen unnamed.

export const STAGE_LABELS = Object.freeze({
  start: 'Read the card',
  'start-build': 'Plan the slices',
  'flow-build': 'Build the slices',
  'finish-build': 'Finish the build',
  'open-pr': 'Open the pull request',
  'build-check': 'Check the build',
  shipping: 'Hand the change to shipping',
  verdict: 'Re-check the verdict still fits the code',
  remediation: 'Send it back to the builder',
  'pass-note': 'Record the verdict',
  gate: 'Wait for main’s checks',
  acceptance: 'Your UAT on the live site',
  'machine-accept': 'Close the UAT step',
  land: 'Merge and read the result back',
  smoke: 'Smoke test the live site',
  'smoke-pass': 'Keep the landed change',
  'stop-report': 'Write the stop report',
  retro: 'Write the retro',
  cleanup: 'Clean up after the card',
  hold: 'Hold at the end of the run',
});

export function stageLabel(id) {
  const key = String(id ?? '');
  if (STAGE_LABELS[key]) return STAGE_LABELS[key];
  const words = key.replaceAll(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Unknown stage';
}
