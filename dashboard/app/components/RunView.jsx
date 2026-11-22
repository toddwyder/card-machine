'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertIcon,
  CircleDotIcon,
  PauseIcon,
  PlayIcon,
  ReturnArrowIcon,
  StopCrossIcon,
  TickIcon,
  UnknownIcon,
  WaitingIcon,
} from './StateIcons.jsx';
import styles from './RunView.module.css';

const POLL_INTERVAL_MS = 3000;

function formatEstimateLabel(label) {
  if (!label) {
    return '';
  }
  return /estimate/i.test(label) ? label : `${label}, estimate`;
}

function getStageStatusText(stage, isCurrent, runStatus) {
  if (stage.state === 'passed' || stage.state === 'passed_with_notes') {
    return 'Done';
  }
  if (stage.state === 'waiting_for_you' || (isCurrent && runStatus === 'waiting_for_you')) {
    return 'Waiting for you';
  }
  if (stage.state === 'stuck') {
    return 'Stuck';
  }
  if (stage.state === 'given_up') {
    return 'Given up';
  }
  if (stage.state === 'sent_back') {
    return stage.roundNumber ? `Round ${stage.roundNumber}` : 'Sent back';
  }
  if (isCurrent || stage.state === 'running') {
    return 'Now';
  }
  return 'Next';
}

function renderStageIcon(stage, isCurrent, runStatus) {
  if (stage.state === 'passed' || stage.state === 'passed_with_notes') {
    return <TickIcon size={15} className={styles.inlineIcon} />;
  }
  if (stage.state === 'waiting_for_you' || (isCurrent && runStatus === 'waiting_for_you')) {
    return <WaitingIcon size={15} className={styles.inlineIcon} />;
  }
  if (stage.state === 'stuck') {
    return <PauseIcon size={15} className={styles.inlineIcon} />;
  }
  if (stage.state === 'given_up') {
    return <StopCrossIcon size={15} className={styles.inlineIcon} />;
  }
  if (stage.state === 'sent_back') {
    return <ReturnArrowIcon size={15} className={styles.inlineIcon} />;
  }
  if (isCurrent || stage.state === 'running') {
    return <PlayIcon size={14} className={styles.inlineIcon} />;
  }
  return <CircleDotIcon size={14} className={styles.inlineIcon} />;
}

function renderStepIcon(state) {
  switch (state) {
    case 'running':
      return <PlayIcon size={14} className={styles.inlineIcon} />;
    case 'passed':
    case 'passed_with_notes':
      return <TickIcon size={15} className={styles.inlineIcon} />;
    case 'sent_back':
      return <ReturnArrowIcon size={15} className={styles.inlineIcon} />;
    case 'stuck':
      return <PauseIcon size={15} className={styles.inlineIcon} />;
    case 'given_up':
      return <StopCrossIcon size={15} className={styles.inlineIcon} />;
    default:
      return <CircleDotIcon size={14} className={styles.inlineIcon} />;
  }
}

function renderActionIcon(state) {
  switch (state) {
    case 'done':
      return <TickIcon size={15} className={styles.actionIconDone} />;
    case 'now':
      return <PlayIcon size={14} className={styles.actionIconNow} />;
    case 'stuck':
      return <PauseIcon size={15} className={styles.actionIconStuck} />;
    default:
      return <CircleDotIcon size={14} className={styles.actionIconTodo} />;
  }
}

function renderRunStatusIndicator(status) {
  switch (status) {
    case 'running':
      return <span className={styles.runningDot} aria-hidden="true" />;
    case 'waiting_for_you':
      return <WaitingIcon size={16} className={styles.inlineIcon} />;
    case 'finished':
      return <TickIcon size={16} className={styles.inlineIcon} />;
    case 'stuck':
      return <PauseIcon size={16} className={styles.inlineIcon} />;
    case 'stopped':
    case 'given_up':
    case 'failed':
      return <StopCrossIcon size={16} className={styles.inlineIcon} />;
    default:
      return <CircleDotIcon size={15} className={styles.inlineIcon} />;
  }
}

function getRunStatusClassName(status) {
  switch (status) {
    case 'waiting_for_you':
      return styles.statusPillWaiting;
    case 'finished':
      return styles.statusPillFinished;
    case 'stuck':
      return styles.statusPillStuck;
    case 'stopped':
    case 'given_up':
    case 'failed':
      return styles.statusPillProblem;
    default:
      return styles.statusPillRunning;
  }
}

function getStepClassName(state) {
  switch (state) {
    case 'running':
      return styles.stepRunning;
    case 'passed':
      return styles.stepPassed;
    case 'passed_with_notes':
      return styles.stepPassedNotes;
    case 'sent_back':
      return styles.stepSentBack;
    case 'stuck':
      return styles.stepStuck;
    case 'given_up':
      return styles.stepGivenUp;
    default:
      return styles.stepPending;
  }
}

function getHelperCardClassName(status) {
  if (status === 'stuck') {
    return `${styles.helperCard} ${styles.helperCardStuck}`;
  }
  if (status === 'stopped' || status === 'failed' || status === 'given_up') {
    return `${styles.helperCard} ${styles.helperCardStopped}`;
  }
  return `${styles.helperCard} ${styles.helperCardWorking}`;
}

function collectActionIds(helpers) {
  const ids = new Set();
  if (!Array.isArray(helpers)) {
    return ids;
  }
  for (const helper of helpers) {
    if (Array.isArray(helper.actions)) {
      for (const action of helper.actions) {
        if (action && action.id) {
          ids.add(`${helper.id}:${action.id}`);
        }
      }
    }
  }
  return ids;
}

export default function RunView({ initialData }) {
  const [snapshot, setSnapshot] = useState(initialData);
  const [pollFailed, setPollFailed] = useState(false);
  const [freshActionIds, setFreshActionIds] = useState(() => new Set());
  const seenActionIdsRef = useRef(collectActionIds(initialData?.run?.helpers));

  const stepListRef = useRef(null);
  const stepRefs = useRef(new Map());
  const [markerRect, setMarkerRect] = useState(null);

  useEffect(() => {
    let active = true;
    let timerId = null;
    let controller = null;

    async function poll() {
      controller = new AbortController();
      try {
        const response = await fetch('/api/run-view', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const nextData = await response.json();
        if (!active) {
          return;
        }

        const nextActionIds = collectActionIds(nextData?.run?.helpers);
        const newlyAdded = new Set();
        for (const key of nextActionIds) {
          if (!seenActionIdsRef.current.has(key)) {
            newlyAdded.add(key);
          }
        }
        seenActionIdsRef.current = nextActionIds;

        setFreshActionIds(newlyAdded);
        setSnapshot(nextData);
        setPollFailed(false);
      } catch (err) {
        if (!active || (err && err.name === 'AbortError')) {
          return;
        }
        setPollFailed(true);
      } finally {
        if (active) {
          timerId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    timerId = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      if (controller !== null) {
        controller.abort();
      }
    };
  }, []);

  const warnings = Array.isArray(snapshot?.warnings) ? snapshot.warnings : [];
  const run = snapshot?.run || null;
  const lastRun = snapshot?.lastRun || null;
  const subscriptions = Array.isArray(snapshot?.subscriptions) ? snapshot.subscriptions : [];

  const stages = Array.isArray(run?.stages) ? run.stages : [];
  const currentStage =
    stages.find((stage) => stage.id === run?.currentStageId) ||
    stages.find((stage) => stage.state === 'running' || stage.state === 'waiting_for_you') ||
    stages[0] ||
    null;

  const currentSteps = Array.isArray(currentStage?.steps) ? currentStage.steps : [];
  const activeStepIndex = (() => {
    if (currentSteps.length === 0) {
      return -1;
    }
    if (typeof run?.currentStepIndex === 'number' && run.currentStepIndex >= 1) {
      const idx = Math.min(currentSteps.length - 1, run.currentStepIndex - 1);
      return currentSteps[idx]?.state === 'running' ? idx : -1;
    }
    return -1;
  })();

  const activeStepId = activeStepIndex >= 0 ? currentSteps[activeStepIndex]?.id : null;

  useLayoutEffect(() => {
    const listEl = stepListRef.current;
    if (!listEl || !activeStepId) {
      setMarkerRect(null);
      return undefined;
    }

    let cancelled = false;

    const updateMarker = () => {
      if (cancelled) {
        return;
      }
      const targetEl = stepRefs.current.get(activeStepId);
      if (!targetEl || !listEl) {
        setMarkerRect(null);
        return;
      }
      setMarkerRect({
        left: targetEl.offsetLeft,
        top: targetEl.offsetTop,
        width: targetEl.offsetWidth,
        height: targetEl.offsetHeight,
      });
    };

    updateMarker();

    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) {
          requestAnimationFrame(updateMarker);
        }
      });
    }

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateMarker);
      observer.observe(listEl);
      const targetEl = stepRefs.current.get(activeStepId);
      if (targetEl) {
        observer.observe(targetEl);
      }
    }

    window.addEventListener('resize', updateMarker);

    return () => {
      cancelled = true;
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('resize', updateMarker);
    };
  }, [activeStepId, currentSteps.length, currentStage?.id]);

  const estimateDollarsText = formatEstimateLabel(run?.estimatedDollarsLabel);
  const lastRunEstimateText = formatEstimateLabel(lastRun?.estimatedDollarsLabel);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <p className={styles.brand}>Julia machine</p>
          <p className={styles.liveStatus} role="status" aria-live="polite">
            {pollFailed ||
            snapshot?.sourceStatus === 'unavailable' ||
            snapshot?.sourceStatus === 'error' ? (
              <>
                <span className={styles.reconnectingDot} aria-hidden="true" />
                Reconnecting
              </>
            ) : snapshot?.sourceStatus === 'fixture' ? (
              'Sample data'
            ) : (
              <>
                <span className={styles.liveDot} aria-hidden="true" />
                Live
              </>
            )}
          </p>
        </div>
      </header>

      <main className={styles.main}>
        {warnings.length > 0 && (
          <section aria-label="Warnings" className={styles.warningsSection}>
            {warnings.map((warning) => {
              const isStuck = warning.kind === 'stuck';
              return (
                <div
                  key={warning.id}
                  role="alert"
                  className={
                    isStuck ? styles.warningBoxStuck : styles.warningBoxSolid
                  }
                >
                  <span className={styles.warningIconWrap}>
                    {isStuck ? <PauseIcon size={18} /> : <AlertIcon size={18} />}
                  </span>
                  <p className={styles.warningCopy}>
                    <strong className={styles.warningTitle}>{warning.title}</strong>{' '}
                    <span>{warning.message}</span>
                  </p>
                </div>
              );
            })}
          </section>
        )}

        {run ? (
          <section aria-label="Current run" className={styles.runPanel}>
            <div className={styles.runTopRow}>
              <p className={styles.cardTitle}>{run.title}</p>
              <p className={`${styles.statusPill} ${getRunStatusClassName(run.status)}`}>
                {renderRunStatusIndicator(run.status)}
                <span>{run.statusLabel}</span>
                {run.elapsedLabel ? (
                  <span className={styles.tabular}>· {run.elapsedLabel}</span>
                ) : null}
              </p>
              {(run.tokensLabel || estimateDollarsText) && (
                <p className={styles.usageSummary}>
                  <span className={styles.usageLeadIn}>Card so far</span>{' '}
                  {run.tokensLabel ? (
                    <strong className={styles.tokensCount}>{run.tokensLabel}</strong>
                  ) : null}
                  {run.tokensLabel && estimateDollarsText ? ' · ' : ''}
                  {estimateDollarsText ? (
                    <span className={styles.estimateText}>{estimateDollarsText}</span>
                  ) : null}
                </p>
              )}
            </div>

            <div className={styles.stageHeroRow}>
              <h1 className={styles.currentStageHeading}>
                {run.currentStageName || currentStage?.name || 'Running'}
              </h1>
              <div className={styles.stageHeroMeta}>
                {run.currentStepIndex && run.currentStepTotal ? (
                  <span className={styles.stepCounter}>
                    step {run.currentStepIndex} of {run.currentStepTotal}
                  </span>
                ) : null}
                {run.roundNumber && run.roundNumber > 1 ? (
                  <span className={styles.roundBadge}>Round {run.roundNumber}</span>
                ) : null}
                {run.currentStepName ? (
                  <span className={styles.currentStepLabel}>
                    {run.currentStepName}
                  </span>
                ) : null}
              </div>
            </div>

            {stages.length > 0 && (
              <ol
                aria-label="Stages"
                className={styles.stageBoard}
                style={{
                  '--stage-board-columns': stages
                    .map((s) =>
                      s.id === (currentStage?.id ?? run.currentStageId) ? '1.9fr' : '1fr'
                    )
                    .join(' '),
                }}
              >
                {stages.map((stage) => {
                  const isCurrent = currentStage ? stage.id === currentStage.id : false;
                  let stageClass = styles.stageUpcoming;
                  if (stage.state === 'given_up') {
                    stageClass = styles.stageGivenUp;
                  } else if (stage.state === 'stuck') {
                    stageClass = styles.stageStuck;
                  } else if (stage.state === 'sent_back') {
                    stageClass = styles.stageSentBack;
                  } else if (isCurrent) {
                    stageClass = styles.stageCurrent;
                  } else if (
                    stage.state === 'passed' ||
                    stage.state === 'passed_with_notes'
                  ) {
                    stageClass = styles.stagePassed;
                  }

                  return (
                    <li
                      key={stage.id}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={`${styles.stageTile} ${stageClass}`}
                    >
                      <span className={styles.stageTileStatus}>
                        {renderStageIcon(stage, isCurrent, run.status)}
                        <span>{getStageStatusText(stage, isCurrent, run.status)}</span>
                      </span>
                      <strong
                        className={
                          stage.state === 'given_up'
                            ? `${styles.stageTileName} ${styles.struckText}`
                            : styles.stageTileName
                        }
                      >
                        {stage.name}
                      </strong>
                      {isCurrent && run.currentStepIndex && run.currentStepTotal ? (
                        <span className={styles.stageTileStepCount}>
                          step {run.currentStepIndex} of {run.currentStepTotal}
                        </span>
                      ) : stage.roundNumber && stage.roundNumber > 1 ? (
                        <span className={styles.stageTileStepCount}>
                          Round {stage.roundNumber}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}

            {currentSteps.length > 0 && (
              <div className={styles.stepsBlock}>
                <div className={styles.stepsTrackWrap}>
                  {markerRect && (
                    <div
                      aria-hidden="true"
                      className={styles.activeStepMarker}
                      style={{
                        transform: `translate3d(${markerRect.left}px, ${markerRect.top}px, 0)`,
                        width: `${markerRect.width}px`,
                        height: `${markerRect.height}px`,
                      }}
                    />
                  )}
                  <ol
                    ref={stepListRef}
                    aria-label={`${currentStage?.name || 'Current stage'} steps`}
                    className={styles.stepsRow}
                  >
                    {currentSteps.map((step) => {
                      const roundNum = step.roundNumber || run.roundNumber;
                      return (
                        <li
                          key={step.id}
                          ref={(node) => {
                            if (node) {
                              stepRefs.current.set(step.id, node);
                            } else {
                              stepRefs.current.delete(step.id);
                            }
                          }}
                          title={step.note || undefined}
                          className={`${styles.stepChip} ${getStepClassName(step.state)}`}
                        >
                          <span className={styles.stepIconWrap}>
                            {renderStepIcon(step.state)}
                          </span>
                          <span
                            className={
                              step.state === 'given_up'
                                ? `${styles.stepName} ${styles.struckText}`
                                : styles.stepName
                            }
                          >
                            {step.name}
                          </span>
                          {step.state === 'running' && (
                            <span className={styles.stepTagNow}>now</span>
                          )}
                          {step.state === 'passed_with_notes' && (
                            <span className={styles.stepTagNotes}>(notes)</span>
                          )}
                          {step.state === 'sent_back' && roundNum ? (
                            <span className={styles.stepTagRound}>
                              Round {roundNum}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section aria-label="Current run" className={styles.idlePanel}>
            <h1 className={styles.idleHeading}>No card running right now</h1>
            {lastRun ? (
              <p className={styles.lastRunLine}>
                <strong>Last run:</strong> {lastRun.title}
                {lastRun.outcome ? ` · ${lastRun.outcome}` : ''}
                {lastRun.tokensLabel ? (
                  <span className={styles.tabular}> · {lastRun.tokensLabel}</span>
                ) : null}
                {lastRunEstimateText ? (
                  <span className={styles.tabular}> · {lastRunEstimateText}</span>
                ) : null}
              </p>
            ) : (
              <p className={styles.lastRunLine}>
                Ready for the next card.
              </p>
            )}
          </section>
        )}

        {run && Array.isArray(run.helpers) && run.helpers.length > 0 && (
          <section aria-label="Helpers" className={styles.helpersSection}>
            <h2 className={styles.sectionHeading}>Helpers</h2>
            <ul className={styles.helpersGrid}>
              {run.helpers.map((helper) => {
                const isStopped =
                  helper.status === 'stopped' ||
                  helper.status === 'failed' ||
                  helper.status === 'given_up';
                const actions = Array.isArray(helper.actions) ? helper.actions : [];

                return (
                  <li
                    key={helper.id}
                    className={getHelperCardClassName(helper.status)}
                  >
                    <div className={styles.helperHeader}>
                      <h3
                        className={
                          isStopped
                            ? `${styles.helperName} ${styles.struckText}`
                            : styles.helperName
                        }
                      >
                        {helper.name}
                      </h3>
                      <p className={styles.helperMeta}>
                        <span>{helper.statusLabel}</span>
                        {helper.tokensLabel ? (
                          <span className={styles.tabular}>
                            {' '}
                            · {helper.tokensLabel}
                          </span>
                        ) : null}
                      </p>
                    </div>

                    {actions.length > 0 && (
                      <ol
                        aria-label={`${helper.name} actions`}
                        className={styles.actionList}
                      >
                        {actions.map((action) => {
                          const actionKey = `${helper.id}:${action.id}`;
                          const isFresh = freshActionIds.has(actionKey);
                          let itemClass = styles.actionItemDone;
                          if (action.state === 'now') {
                            itemClass = styles.actionItemNow;
                          } else if (action.state === 'stuck') {
                            itemClass = styles.actionItemStuck;
                          } else if (action.state !== 'done') {
                            itemClass = styles.actionItemTodo;
                          }

                          return (
                            <li
                              key={action.id}
                              className={`${styles.actionItem} ${itemClass} ${
                                isFresh ? styles.actionSlideIn : ''
                              }`}
                            >
                              <span className={styles.actionIconWrap}>
                                {renderActionIcon(action.state)}
                              </span>
                              <span className={styles.actionLabel}>
                                {action.label}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className={styles.helpersLegend}>
              <span className={styles.legendItem}>
                <TickIcon size={14} className={styles.inlineIcon} /> done
              </span>
              <span className={styles.legendItem}>
                <PlayIcon size={13} className={styles.inlineIcon} /> now
              </span>
              <span className={styles.legendItem}>
                <PauseIcon size={14} className={styles.inlineIcon} /> stuck
              </span>
              <span className={styles.legendDivider} aria-hidden="true">
                ·
              </span>
              <span>Solid edge: working · Dashed: stuck · Struck through: stopped</span>
            </p>
          </section>
        )}

        <section aria-label="Left in each subscription" className={styles.quotaSection}>
          <h2 className={styles.quotaHeading}>Left in each subscription</h2>
          <ul className={styles.quotaList}>
            {subscriptions.map((sub) => {
              if (sub.status === 'unknown') {
                return (
                  <li key={sub.id} className={styles.quotaRow}>
                    <strong className={styles.quotaName}>{sub.name}</strong>
                    <div
                      role="img"
                      aria-label={`${sub.name} quota unknown`}
                      className={styles.quotaTrackUnknown}
                    />
                    <span className={styles.quotaValueUnknown}>
                      <UnknownIcon size={15} className={styles.inlineIcon} />
                      <strong>unknown</strong>
                    </span>
                  </li>
                );
              }

              const percent = Math.max(
                0,
                Math.min(100, Number.isFinite(sub.percentLeft) ? sub.percentLeft : 0)
              );
              const isLow = percent <= 20;
              const isMedium = percent > 20 && percent <= 40;

              let fillClass = styles.quotaFillHealthy;
              if (isLow) {
                fillClass = styles.quotaFillLow;
              } else if (isMedium) {
                fillClass = styles.quotaFillMedium;
              }

              const detailText = sub.resetLabel || sub.windowLabel || '';

              return (
                <li key={sub.id} className={styles.quotaRow}>
                  <strong className={styles.quotaName}>{sub.name}</strong>
                  <div
                    role="img"
                    aria-label={`${sub.name} ${percent} percent left`}
                    className={
                      isLow ? styles.quotaTrackLow : styles.quotaTrack
                    }
                  >
                    <div
                      className={`${styles.quotaFill} ${fillClass}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span
                    className={
                      isLow ? styles.quotaValueLow : styles.quotaValue
                    }
                  >
                    {isLow ? (
                      <AlertIcon size={15} className={styles.inlineIcon} />
                    ) : null}
                    <strong className={styles.quotaPercent}>{percent}%</strong>
                    {detailText ? ` · ${detailText}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
