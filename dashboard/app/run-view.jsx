'use client';

import { useEffect, useRef, useState } from 'react';
import { BASE_PATH } from '../lib/base-path.mjs';
import styles from './run-view.module.css';

const POLL_MS = 2000;

const STATE_WORDS = {
  running: 'Running',
  waiting_for_you: 'Waiting for you',
  stuck: 'Stuck',
  stopped: 'Stopped',
  finished: 'Finished',
  ended_unknown: 'Ended, result unknown',
};

// Which mark each state and warning draws. The table is the one place a state becomes a shape,
// so the screen cannot show a live ring beside a run that is over.
const MARK_OF_STATE = { running: 'working', waiting_for_you: 'working', stuck: 'stuck', stopped: 'failed', ended_unknown: 'stuck' };
const MARK_OF_WARNING = { stopped: 'failed', burning_fast: 'failed', stuck: 'stuck', ended_unknown: 'stuck' };

const HELPER_WORDS = {
  working: 'Working',
  done: 'Finished',
  failed: 'Stopped',
  stuck: 'Stuck',
};

function underAMinute(seconds) {
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'a minute ago' : `${minutes} min ago`;
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms === null) return 'time unknown';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

function tokenCount(tokens) {
  if (!tokens) return 'no tokens yet';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)} M tokens`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)} k tokens`;
  return `${tokens} tokens`;
}

function money(dollars) {
  if (dollars === null || dollars === undefined) return 'not priced yet';
  return `about $${dollars.toFixed(2)}, estimate`;
}

function resetDay(resetsAt) {
  if (!resetsAt) return 'no reset date yet';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(resetsAt));
}

// Every state is drawn as a shape as well as a colour: a tick, a ring, a pause, a cross, a dot.
function Mark({ state }) {
  const frame = { width: 15, height: 15, viewBox: '0 0 15 15', 'aria-hidden': 'true', className: styles.mark, 'data-state': state };
  if (state === 'done') {
    return (
      <svg {...frame}>
        <circle cx="7.5" cy="7.5" r="6.6" className={styles.markFill} />
        <path d="M4.3 7.7 6.4 9.8 10.7 5.4" className={styles.markStroke} fill="none" />
      </svg>
    );
  }
  if (state === 'working' || state === 'in_progress') {
    return (
      <svg {...frame}>
        <circle cx="7.5" cy="7.5" r="5.5" className={styles.markRing} />
        <circle cx="7.5" cy="7.5" r="2.2" className={styles.markFill} />
      </svg>
    );
  }
  if (state === 'stuck') {
    return (
      <svg {...frame}>
        <rect x="1.4" y="1.4" width="12.2" height="12.2" rx="3.4" className={styles.markDashed} />
        <rect x="4.7" y="4.6" width="1.9" height="5.8" className={styles.markFill} />
        <rect x="8.4" y="4.6" width="1.9" height="5.8" className={styles.markFill} />
      </svg>
    );
  }
  if (state === 'skipped') {
    return (
      <svg {...frame}>
        <circle cx="7.5" cy="7.5" r="5.5" className={styles.markRing} />
        <path d="M3.9 11.1 11.1 3.9" className={styles.markRing} />
      </svg>
    );
  }
  if (state === 'failed') {
    return (
      <svg {...frame}>
        <circle cx="7.5" cy="7.5" r="6.6" className={styles.markFill} />
        <path d="M4.8 4.8 10.2 10.2M10.2 4.8 4.8 10.2" className={styles.markStroke} fill="none" />
      </svg>
    );
  }
  return (
    <svg {...frame}>
      <circle cx="7.5" cy="7.5" r="5.4" className={styles.markRing} />
    </svg>
  );
}

function Warnings({ warnings }) {
  if (!warnings.length) return null;
  return (
    <ul className={styles.warnings}>
      {warnings.map((warning, index) => (
        <li key={`${warning.kind}-${index}`} className={styles.warning} data-kind={warning.kind}>
          <p className={styles.warningTitle}>
            <Mark state={MARK_OF_WARNING[warning.kind] ?? 'failed'} />
            <span>{warning.title}</span>
          </p>
          <p className={styles.warningText}>{warning.text}</p>
        </li>
      ))}
    </ul>
  );
}

// The run's steps in one row, the one it is on filled in, and the count in words beside them.
function StepRow({ steps }) {
  if (!steps || !steps.list.length) return null;
  return (
    <div className={styles.stepStrip}>
      <ol className={styles.steps} aria-label={`The run's ${steps.total} steps`}>
        {steps.list.map((step, position) => (
          <li
            key={step.id}
            className={styles.step}
            data-state={step.status}
            data-number={position + 1}
            aria-current={step.status === 'in_progress' ? 'step' : undefined}
          >
            <Mark state={step.status === 'completed' ? 'done' : step.status} />
            <span>{step.short}</span>
          </li>
        ))}
      </ol>
      <p className={styles.stepCount} data-index={steps.index} data-total={steps.total}>
        step <b>{steps.index}</b> of <b>{steps.total}</b>
      </p>
    </div>
  );
}

// The stage is the name of the playbook the session follows; the steps under it are that
// playbook's steps from the session's own to-do list.
function Stage({ stage, step, steps }) {
  if (!stage) return <p className={styles.stageWaiting}>The session has not named its playbook yet.</p>;
  return (
    <div className={styles.stageBlock}>
      <h2 className={styles.stageName}>{stage}</h2>
      {step ? <p className={styles.nowStep}>{step}</p> : null}
      <StepRow steps={steps} />
    </div>
  );
}

// The cards Start can begin. Start shows only while nothing is running, and it goes away as soon
// as the run it began appears.
function ReadyCards({ ready, onStart, starting }) {
  if (ready.error) return <p className={styles.readyNote}>{ready.error}</p>;
  if (!ready.cards.length) return <p className={styles.readyNote}>No card is Ready right now.</p>;
  return (
    <ul className={styles.readyList}>
      {ready.cards.map(card => (
        <li key={card.id} className={styles.readyCard}>
          <div className={styles.readyHead}>
            <span className={styles.readyIdentifier}>{card.identifier}</span>
            <h3 className={styles.readyTitle}>{card.title}</h3>
          </div>
          <button
            type="button"
            className={styles.start}
            onClick={() => onStart(card.identifier)}
            disabled={starting !== null}
          >
            {starting === card.identifier ? 'Starting…' : 'Start'}
          </button>
        </li>
      ))}
    </ul>
  );
}

function HelperCard({ helper, observedAt }) {
  const status = HELPER_WORDS[helper.status] ?? helper.status;
  return (
    <article className={styles.helper} data-state={helper.status}>
      <h3 className={styles.helperName}>{helper.name}</h3>
      <p className={styles.helperLine}>
        <Mark state={helper.status === 'working' ? 'working' : helper.status} />
        <span>{status}</span>
        <span className={styles.dot}>·</span>
        <span>{tokenCount(helper.tokens)}</span>
      </p>
      {helper.actions.length ? (
        <ul className={styles.actions}>
          {helper.actions.map(action => (
            <li key={action.id} className={styles.action} data-state={action.status}>
              <Mark state={action.status === 'started' ? 'working' : action.status === 'failed' ? 'failed' : 'done'} />
              <span className={styles.actionName}>{action.name}</span>
              <span className={styles.actionTime}>{underAMinute(Math.max(0, (observedAt - action.at) / 1000))}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.helperQuiet}>No actions yet.</p>
      )}
      {helper.tasks.length ? (
        <ol className={styles.tasks}>
          {helper.tasks.map(task => (
            <li key={task.id} className={styles.task} data-state={task.status}>
              <Mark state={task.status} />
              <span>{task.title}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

const WINDOW_WORDS = { five_hour: '5-hour window', weekly: 'week' };

// Why a subscription reads "unknown", in Todd's words. The reason is one of four short values
// the server picked; anything it does not recognise still names a caption.
const UNKNOWN_REASONS = {
  'no stored sign-in': 'No sign-in is stored for this subscription.',
  'sign-in expired': 'The stored sign-in has expired.',
  'reading failed': 'The server could not read this subscription.',
  'timed out': 'The reading took too long to answer.',
};

function QuotaBar({ subscription }) {
  if (subscription.status !== 'fresh') {
    const reason = subscription.reason ?? 'reading failed';
    return (
      <li className={styles.quotaRow} data-state="unknown" data-subscription={subscription.id} data-reason={reason}>
        <span className={styles.quotaName}>{subscription.name}</span>
        <div className={styles.windows}>
          <span className={styles.quotaUnknown}>Reading failed, unknown</span>
          <span className={styles.quotaReason}>{UNKNOWN_REASONS[reason] ?? UNKNOWN_REASONS['reading failed']}</span>
        </div>
      </li>
    );
  }
  // A reading carries one window per limit the provider counts against, and each window's
  // percentage belongs with its own reset date. Every window it read gets its own bar.
  const windows = subscription.windows ?? [];
  const low = windows.some(window => window.low);
  return (
    <li className={styles.quotaRow} data-state={low ? 'low' : 'ok'} data-subscription={subscription.id}>
      <span className={styles.quotaName}>{subscription.name}</span>
      <div className={styles.windows}>
        {windows.length ? (
          windows.map(window => (
            <p key={window.window} className={styles.window} data-state={window.low ? 'low' : 'ok'} data-window={window.window}>
              <span className={styles.windowName}>{WINDOW_WORDS[window.window] ?? window.window}</span>
              <span className={styles.bar} role="img" aria-label={`${window.percentLeft}% of this ${WINDOW_WORDS[window.window] ?? window.window} left`}>
                <span className={styles.barFill} style={{ width: `${Math.max(0, Math.min(100, window.percentLeft))}%` }} />
              </span>
              <span className={styles.quotaReset}>
                {window.percentLeft}% left · refills {resetDay(window.resetsAt)}
              </span>
            </p>
          ))
        ) : (
          <span className={styles.quotaUnknown}>Reading failed, unknown</span>
        )}
      </div>
    </li>
  );
}

export function RunView({ initialSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [offline, setOffline] = useState(false);
  const [starting, setStarting] = useState(null);
  const [startError, setStartError] = useState(null);
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (busy.current) return;
      busy.current = true;
      try {
        const response = await fetch(`${BASE_PATH}/api/run-view`, { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json();
        if (!stopped) {
          setSnapshot(next);
          setOffline(false);
        }
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        busy.current = false;
      }
    }
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  async function start(identifier) {
    setStarting(identifier);
    setStartError(null);
    try {
      const response = await fetch(`${BASE_PATH}/api/start`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setStartError(body.error ?? 'The card did not start.');
      }
      // Read the screen again straight away, so the run appears without waiting for the next tick.
      const next = await fetch(`${BASE_PATH}/api/run-view`, { cache: 'no-store' });
      if (next.ok) setSnapshot(await next.json());
    } catch {
      setStartError('The card did not start.');
    } finally {
      setStarting(null);
    }
  }

  const { run, subscriptions, warnings, readyCards } = snapshot;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.wordmark}>Mission control</p>
        <p className={styles.headerNote}>{offline ? 'Losing touch with the machine, retrying' : 'Run view'}</p>
      </header>

      <main className={styles.main}>
        <Warnings warnings={warnings} />

        {run ? (
          <section className={styles.panel} aria-label="The running card">
            <div className={styles.panelTop}>
              <div>
                <h1 className={styles.title}>{run.title}</h1>
                <p className={styles.runLine} data-run-state={run.status}>
                  <Mark state={MARK_OF_STATE[run.status] ?? 'working'} />
                  <span>
                    {STATE_WORDS[run.status] ?? run.status} · {duration(run.runningMs)}
                  </span>
                </p>
              </div>
              <p className={styles.spend}>
                {tokenCount(run.usage.tokens)}
                <span className={styles.dot}>·</span>
                {money(run.usage.dollarsEstimate)}
              </p>
            </div>
            <Stage stage={run.stage} step={run.step} steps={run.steps} />
          </section>
        ) : (
          <section className={styles.quiet} aria-label="Nothing running">
            <h1 className={styles.quietTitle}>Nothing is running right now</h1>
            <p className={styles.quietText}>
              {snapshot.lastResult
                ? `The last run ${snapshot.lastResult.status === 'finished' ? 'finished' : snapshot.lastResult.status}.`
                : 'The machine is idle. Start a Ready card and its run appears here by itself.'}
            </p>
            <ReadyCards ready={readyCards ?? { cards: [], error: null }} onStart={start} starting={starting} />
            {startError ? (
              <p className={styles.readyNote} role="alert">
                {startError}
              </p>
            ) : null}
          </section>
        )}

        {run && run.helpers?.length ? (
          <section aria-labelledby="helpers-heading">
            <h2 id="helpers-heading" className={styles.sectionTitle}>
              Helpers
            </h2>
            <div className={styles.helpers}>
              {run.helpers.map(helper => (
                <HelperCard key={helper.id} helper={helper} observedAt={snapshot.observedAt} />
              ))}
            </div>
          </section>
        ) : null}

        <section className={styles.quota} aria-labelledby="quota-heading">
          <h2 id="quota-heading" className={styles.sectionTitle}>
            Subscriptions
          </h2>
          <ul className={styles.quotaList}>
            {subscriptions.map(subscription => (
              <QuotaBar key={subscription.id} subscription={subscription} />
            ))}
          </ul>
        </section>

        <p className={styles.legend}>
          Filled tick: done. Ring: working. Dashed box: stuck or ended without a result. Cross: stopped. Dotted edge: burning. Struck title: stopped.
        </p>
      </main>
    </div>
  );
}
