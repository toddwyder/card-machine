# The Run view against a real run

This is the proof for the card's first done check: the screen read beside the run's own trace,
not beside a fixture. The machine ran a card down its real workflow and wrote its real live file,
a real `state.db` and a real `trace.duckdb`; the screen was then served from that file and each
value on it was paired with the trace row for the same moment.

## What ran

| Part | Real or stand-in |
| --- | --- |
| Workflow, stages, storage, trace, live writer | the machine's own code (`machine/flow/`) |
| Model | `createMockModel` from `@mastra/core/test-utils/llm-mock`, the stand-in `machine/flow/workflow.test.mjs` uses |
| Shipping, review, check, preflight | the stand-ins `machine/flow/workflow.test.mjs` uses; no real pull request |
| Quota readings | the real readers, real endpoints |

A paid model call and a real pull request are the two things this environment must not do, so
the drive script swaps exactly those. Everything the screen reads is the machine's own output.

```sh
node .artifacts/flow/proof-JUL-361/drive.mjs start
# -> suspended at attempt/acceptance, request JUL-361-PROOF/build-1
node .artifacts/flow/proof-JUL-361/drive.mjs resume 299f344c-d6c9-4e40-b993-1959002490bf
# -> status success, cleaned up
FLOW_DIR=$PWD/.artifacts/flow/proof-JUL-361/run npx next start --port 4314
curl http://127.0.0.1:4314/control/api/run-view
```

The run is `JUL-361-PROOF`. Its live file is 36 lines: 32 stage events, one run event, two agent
events and one model event. It opens on `start` and ends on `cleanup` done, which is what a real
card does.

## What the screen said, twice

Read while the run held at the acceptance gate, then again after it finished.

| Moment | Screen |
| --- | --- |
| held at the gate | `status: waiting_for_you`, stage "Your UAT on the live site" `waiting`, no warnings |
| after resume | `status: finished`, stage "Clean up after the card" done, 15 stages, 48.9 s running |

Both reads came over HTTP twice with identical bodies (`moment1.json`, `moment2.json`), and the
cold request took 0.43 s with a warm one at 0.25 s.

## Pairing the screen with the trace

Every stage the screen lists, against the `workflow_step` span that opened it:

| Stage | Label on screen | Screen (ms) | Trace (ms) | Delta |
| --- | --- | --- | --- | --- |
| start | Read the card | 1795338651671 | 1795338651660 | 11 |
| start-build | Plan the slices | 1795338651716 | 1795338651713 | 3 |
| flow-build | Build the slices | 1795338651867 | 1795338651865 | 2 |
| finish-build | Open the pull request | 1795338652304 | 1795338652302 | 2 |
| build-check | Check the build | 1795338652308 | 1795338652307 | 1 |
| shipping | Hand the change to shipping | 1795338652338 | 1795338652335 | 3 |
| verdict | Re-check the verdict still fits the code | 1795338652345 | 1795338652343 | 2 |
| pass-note | Record the verdict | 1795338652356 | 1795338652354 | 2 |
| gate | Wait for main's checks | 1795338652372 | 1795338652370 | 2 |
| acceptance | Your UAT on the live site | 1795338652389 | 1795338652387 | 2 |
| land | Merge and read the result back | 1795338699543 | 1795338699540 | 3 |
| smoke | Smoke test the live site | 1795338699557 | 1795338699555 | 2 |
| smoke-pass | Keep the landed change | 1795338699572 | 1795338699569 | 3 |
| retro | Write the retro | 1795338699610 | 1795338699607 | 3 |
| cleanup | Clean up after the card | 1795338699627 | 1795338699624 | 3 |

15 of 15 stages matched, the slowest 11 ms apart, because the span's clock and the feed's clock
read the same instant from two places. The 38 s between `acceptance` and `land` is the gate
waiting for Todd, and the screen read it as `waiting_for_you` at that moment.

Tokens: the screen showed 30, and the trace has one distinct `model_inference` span with
`inputTokens` 10 and `outputTokens` 20. The trace also carries a `model_generation` span with the
same usage above each inference, so a naive sum over both types would double count. The writer
counts the inference only, and the pairing collapses the trace the same way.

Helper: the screen showed one helper, "Lead". The trace has one `agent_run` span, `entityId`
`flow-build`, and one model call under it. No tool or task events appear because the mock model
calls no tools, so the run produced none to show.

## Caveats, stated rather than hidden

- **Tokens are the mock model's own numbers.** A mock call reports 10 in and 20 out regardless of
  the prompt, so 30 is the true usage of that call, not the usage a real builder would spend.
- **The dollar figure is null, not zero.** `mock-model-id` is not in `dashboard/lib/model-prices.js`,
  so there is no price to estimate from. A real card's model is priced there.
- **One helper, no actions.** The mock build does one turn with no tool calls, so the helper cards
  carry the name and the token count and no actions. Helper actions are proven from the writer's
  own spans in `dashboard/lib/run-view.test.mjs` and in the browser suite, not from this run.
- **Claude reads `unknown`.** Its stored sign-in expired at 05:45Z and the refresh path returns
  nothing, so the bar shows `unknown` with the reason. ChatGPT and CommandCode read fresh from
  their live endpoints in the same request.

## What this run found

Two defects that no fixture had caught, both fixed at their source:

1. The fold treated only `hold` as an ending, so a run that finishes on `cleanup` read as still
   running. A real run's last stage is `cleanup`.
2. The writer published the span's label (`agent run: 'flow-build'`) as the agent's identity, so
   the screen would have shown "Agent Run: 'Flow Build'" instead of "Lead". Mastra keeps the id on
   `entityId`. The screenshots above were taken after both fixes.

The pre-fix log is kept beside this run at `.artifacts/flow/proof-JUL-361/run-prefix/` for
comparison.
