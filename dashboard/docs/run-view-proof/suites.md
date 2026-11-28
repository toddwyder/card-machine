# The Run view's suites, run on the top of the stack

Saved from `fix/run-view-e2e-passes` after the card-session fixes landed under it.
Both suites pass; the full machine-readable result is `.e2e/final/report.json`
and the screenshots are under `.e2e/final/results/` on the machine that ran them.

## End-to-end suite

`npx e2e run tests/run-view.e2e.ts --output .e2e/final` → exit 0, 7/7 tests.

```
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > folds the screen at the pinned instant 1.76s
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > shows the stage, its steps, and the spend the session left behind on a laptop 1.01s
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > names the playbook the list has moved on to 1.20s
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > draws each warning state by its own shape 2.17s
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > renders subscription bars matching readings and unknown on failed readings 999ms
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > shows a finished run, the idle screen, and the spend changing live 4.20s
   ✓  web  tests/run-view.e2e.ts > Mission control Run view > stacks warnings, panel, and bars on a 390px phone with no overflow 1.03s
 ✓  web  tests/run-view.e2e.ts (7 tests) 12.37s

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  06:38:05
   Duration  14.54s (startup 1.39s)
```

## Browser suite

`cd dashboard && npx playwright test` → exit 0, 14/14 tests.

```
[1/14] [chromium] › tests/run-view.spec.mjs:21:1 › folds the screen at the instant the proof pictures are pinned to
[2/14] [chromium] › tests/run-view.spec.mjs:62:3 › the Run view on a laptop › shows where a live card is, what it used, and the steps it wrote
[3/14] [chromium] › tests/run-view.spec.mjs:111:3 › the Run view on a laptop › says a session has not named its playbook yet, and still draws the run
[4/14] [chromium] › tests/run-view.spec.mjs:126:3 › the Run view on a laptop › moves the marker and the stage when the session changes playbook
[5/14] [chromium] › tests/run-view.spec.mjs:149:3 › the Run view on a laptop › shows every ended run as quiet, with its last result and its Ready cards back
[6/14] [chromium] › tests/run-view.spec.mjs:188:3 › the Run view on a laptop › draws stuck as a dashed box and says how long the session has been quiet
[7/14] [chromium] › tests/run-view.spec.mjs:205:3 › the Run view on a laptop › draws a run spending faster than the limit as a dotted warning that names the rate
[8/14] [chromium] › tests/run-view.spec.mjs:217:3 › the Run view on a laptop › draws a low window as a ringed bar, matched to that window's own reading
[9/14] [chromium] › tests/run-view.spec.mjs:247:3 › the Run view on a laptop › tells an expired sign-in from no sign-in at all
[10/14] [chromium] › tests/run-view.spec.mjs:260:3 › the Run view on a laptop › offers a Start on each Ready card while nothing runs
[11/14] [chromium] › tests/run-view.spec.mjs:285:3 › the Run view on a laptop › says the queue is empty instead of offering a Start it cannot back
[12/14] [chromium] › tests/run-view.spec.mjs:296:3 › the Run view on a laptop › says it could not read the Ready cards rather than looking empty
[13/14] [chromium] › tests/run-view.spec.mjs:312:3 › the Run view on a phone › puts the warnings first, stacks the panel, and keeps the step row on a narrow screen
[14/14] [chromium] › tests/run-view.spec.mjs:354:3 › the Run view on a phone › reads an ended run by its dashes on a narrow screen too
  14 passed (2.0m)
```
