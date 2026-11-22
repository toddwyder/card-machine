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
};

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
            <Mark state={warning.kind === 'stuck' ? 'stuck' : 'failed'} />
            <span>{warning.title}</span>
          </p>
          <p className={styles.warningText}>{warning.text}</p>
        </li>
      ))}
    </ul>
  );
}

function StageRail({ stages, current, step }) {
  const passed = stages.filter(stage => stage !== current);
  return (
    <ol className={styles.rail}>
      {passed.map(stage => (
        <li key={stage.id} className={styles.past} data-state={stage.status}>
          <Mark state={stage.status === 'failed' ? 'failed' : 'done'} />
          <span>{stage.label}</span>
        </li>
      ))}
      {current ? (
        <li className={styles.now}>
          <p className={styles.nowKicker}>
            <Mark state={current.status === 'failed' ? 'failed' : 'working'} />
            <span>{current.status === 'failed' ? 'Stopped in' : 'Now'}</span>
          </p>
          <p className={styles.nowName}>{current.label}</p>
          {step ? <p className={styles.nowStep}>{step}</p> : null}
        </li>
      ) : null}
    </ol>
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

function QuotaBar({ subscription }) {
  if (subscription.status !== 'fresh') {
    return (
      <li className={styles.quotaRow} data-state="unknown" data-subscription={subscription.id}>
        <span className={styles.quotaName}>{subscription.name}</span>
        <div className={styles.windows}>
          <span className={styles.quotaUnknown}>Reading failed, unknown</span>
          <span className={styles.quotaReset}>no reading</span>
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

  const { run, subscriptions, warnings } = snapshot;

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
                <p className={styles.runLine}>
                  <Mark state={run.status === 'stuck' ? 'stuck' : run.status === 'stopped' ? 'failed' : 'working'} />
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
            <StageRail stages={run.stages} current={run.stage} step={run.step} />
          </section>
        ) : (
          <section className={styles.quiet} aria-label="Nothing running">
            <h1 className={styles.quietTitle}>Nothing is running right now</h1>
            <p className={styles.quietText}>
              {snapshot.lastResult
                ? `The last run ${snapshot.lastResult.status === 'finished' ? 'finished' : snapshot.lastResult.status}.`
                : 'The machine is idle. The next card that starts will appear here by itself.'}
            </p>
          </section>
        )}

        {run ? (
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
          Filled tick: done. Ring: working. Dashed box: stuck. Cross: stopped. Dotted edge: burning. Struck title: stopped.
        </p>
      </main>
    </div>
  );
}
