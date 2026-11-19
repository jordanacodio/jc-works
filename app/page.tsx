'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { continueAsGuest, continueWithGoogle, firebaseReady, loadWorkoutHistory, savePlayerProfile, saveWorkout, signOutAccount, watchAccount, type AccountUser, type PlayerProfile, type SavedWorkout } from '../lib/firebase';
import PoseTracker, { type PoseSummary } from '../components/PoseTracker';

type Step = 'home' | 'assessment' | 'workout' | 'summary' | 'history' | 'film';
type Drill = { name: string; minutes: number; target: string; cue: string };

const goalOptions = ['3-point shooting', 'Finishing', 'Ball handling', 'Pull-up shooting'];
const equipmentOptions = ['Full court', 'Half court', 'Shooting machine', 'Cones', 'Partner'];
const workout: Drill[] = [
  { name: 'Rhythm & range warm-up', minutes: 5, target: '20 makes inside-out, finishing at game range', cue: 'Hold your finish. Same balance on every rep.' },
  { name: 'Handle into first-step attacks', minutes: 5, target: '3 rounds × 30 sec each hand', cue: 'Shift the defender, then win the first two steps.' },
  { name: 'Five-spot 3-point calibration', minutes: 10, target: '10 attempts at each spot', cue: 'Track every spot separately—quality before speed.' },
  { name: 'Movement 3s', minutes: 8, target: '5 makes each: lift, drift, sprint-in', cue: 'Arrive on balance and get your feet down early.' },
  { name: 'Weak-hand finish series', minutes: 7, target: '5 makes each: extension, inside-hand, contact', cue: 'Keep the ball outside your frame and finish high.' },
  { name: 'Floater decision reps', minutes: 4, target: '8 makes alternating one-foot and two-foot', cue: 'Eyes to the rim early; release before the shot blocker.' },
  { name: 'Pressure closeout', minutes: 3, target: 'Make 2 in a row from 3 locations', cue: 'Reset your breath before every shot.' },
];

export default function Home() {
  const [step, setStep] = useState<Step>('home');
  const [playerName, setPlayerName] = useState('Jordana');
  const [level, setLevel] = useState('College');
  const [position, setPosition] = useState('Guard');
  const [goals, setGoals] = useState<string[]>(['3-point shooting', 'Finishing']);
  const [equipment, setEquipment] = useState<string[]>(['Full court', 'Shooting machine']);
  const [duration, setDuration] = useState(40);
  const [weakness, setWeakness] = useState('Inconsistent 3-point shooting and weak-hand finishing');
  const [results, setResults] = useState<Record<number, { makes: number; attempts: number }>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [history, setHistory] = useState<SavedWorkout[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [filmInterest, setFilmInterest] = useState(false);
  const [filmClip, setFilmClip] = useState<'make' | 'miss'>('make');
  const [filmTime, setFilmTime] = useState(0);
  const [poseSummaries, setPoseSummaries] = useState<Partial<Record<'make' | 'miss', PoseSummary>>>({});
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [accountError, setAccountError] = useState('');
  const totalMinutes = workout.reduce((sum, drill) => sum + drill.minutes, 0);
  const totals = useMemo(() => Object.values(results).reduce((sum, item) => ({ makes: sum.makes + item.makes, attempts: sum.attempts + item.attempts }), { makes: 0, attempts: 0 }), [results]);
  const currentFilmCue = filmClip === 'make'
    ? filmTime < 1.75 ? 'SET — Center the ball and stay balanced.'
      : filmTime < 2.25 ? 'LOAD — Rise smoothly from your legs.'
      : filmTime < 2.75 ? 'RELEASE — Extend through the center.'
      : 'FINISH — Hold your wrist at the target.'
    : filmTime < 1.65 ? 'SET — Match your made-shot balance.'
      : filmTime < 2.15 ? 'LOAD — Keep the same centered rise.'
      : filmTime < 2.70 ? 'RELEASE — Keep your shooting hand centered.'
      : 'RESULT — The hand drifted right before returning to center.';
  const updateFilmTime = useCallback((time: number) => setFilmTime(time), []);
  const updatePoseSummary = useCallback((clip: 'make' | 'miss', summary: PoseSummary) => {
    setPoseSummaries((current) => ({ ...current, [clip]: summary }));
  }, []);
  const makePose = poseSummaries.make;
  const missPose = poseSummaries.miss;
  const comparisonReady = Boolean(makePose && missPose && makePose.frames > 5 && missPose.frames > 5);
  const trackedDifference = comparisonReady && makePose && missPose
    ? makePose.minKneeAngle + 5 < missPose.minKneeAngle
      ? 'The made shot used a deeper knee load before the release.'
      : makePose.maxElbowAngle > missPose.maxElbowAngle + 5
        ? 'The made shot reached more shooting-arm extension through the release.'
        : makePose.maxWristLift > missPose.maxWristLift + .025
          ? 'The made shot reached a slightly higher wrist finish, while elbow extension stayed close.'
          : 'The tracked body positions were close, so the next test should focus on timing, touch, and a centered finish.'
    : 'Play both clips to build an automatic make-versus-miss comparison.';

  useEffect(() => watchAccount((user) => { setAccount(user); setAccountReady(true); }), []);

  const googleSignIn = async () => {
    setAccountError('');
    try { setAccount(await continueWithGoogle()); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown Firebase error';
      setAccountError(`Google sign-in could not start: ${detail}`);
    }
  };
  const guestSignIn = async () => {
    setAccountError('');
    try { setAccount(await continueAsGuest()); }
    catch { setAccountError('Guest access is unavailable right now.'); }
  };

  const toggle = (value: string, list: string[], setter: (items: string[]) => void, max?: number) => {
    if (list.includes(value)) setter(list.filter((item) => item !== value));
    else if (!max || list.length < max) setter([...list, value]);
  };
  const updateResult = (index: number, field: 'makes' | 'attempts', value: number) => {
    setResults((current) => ({ ...current, [index]: { makes: current[index]?.makes || 0, attempts: current[index]?.attempts || 0, [field]: Math.max(0, value) } }));
  };
  const profile = (): PlayerProfile => ({ name: playerName.trim() || 'Player', level, position, goals, equipment, duration, weakness });
  const generateWorkout = async () => {
    setStep('workout');
    if (!firebaseReady) return;
    try { await savePlayerProfile(profile()); } catch { setSaveStatus('error'); }
  };
  const finishWorkout = async () => {
    setStep('summary');
    if (!firebaseReady) { setSaveStatus('error'); return; }
    setSaveStatus('saving');
    try {
      await saveWorkout(profile(), {
        makes: totals.makes,
        attempts: totals.attempts,
        percentage: totals.attempts ? Math.round((totals.makes / totals.attempts) * 100) : null,
        duration,
        focus: 'Corner consistency under fatigue',
        drillResults: results,
      });
      setHistory(await loadWorkoutHistory());
      setSaveStatus('saved');
    } catch { setSaveStatus('error'); }
  };
  const openHistory = async () => {
    setStep('history');
    if (!firebaseReady) { setHistoryStatus('error'); return; }
    setHistoryStatus('loading');
    try {
      setHistory(await loadWorkoutHistory());
      setHistoryStatus('loaded');
    } catch { setHistoryStatus('error'); }
  };

  return <main>
    <nav className="nav shell">
      <button className="brand" onClick={() => setStep('home')} aria-label="JC Works home"><span>JC</span> WORKS</button>
      <p className="nav-tag">Built around your game.</p>
      <div className="nav-links"><button className="nav-action" onClick={() => setStep('film')}>JC Works Film</button><button className="nav-action" onClick={openHistory}>Saved results</button>{account && !account.isGuest ? <div className="account-pill">{account.photoURL && <img src={account.photoURL} alt="" referrerPolicy="no-referrer"/>}<span>{account.name}</span><button onClick={async () => { await signOutAccount(); setAccount(null); }}>Sign out</button></div> : <button className="google-mini" onClick={googleSignIn}>Sign in</button>}<button className="nav-action build-link" onClick={() => setStep('assessment')}>Build my workout <span>↗</span></button></div>
    </nav>

    {step === 'home' && <>
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow">PERSONALIZED BASKETBALL TRAINING</p>
          <h1>You&apos;re not generic.<br/><em>Your workout shouldn&apos;t be either.</em></h1>
          <p className="lede">JC Works gives high-school and college players focused workouts built around their game—not the same workout everyone else gets.</p>
          <div className="hero-actions"><button className="primary" onClick={() => setStep('assessment')}>Try the workout demo <span>→</span></button><button className="text-action" onClick={() => setStep('film')}>See film analysis</button></div>
          {accountReady && (!account || account.isGuest) && <div className="signin-card"><p className="eyebrow">SAVE ACROSS DEVICES</p><h2>Keep your workouts with you.</h2><p>Sign in once to see your player profile and past results anywhere.</p><button className="google-button" onClick={googleSignIn}><span className="google-g">G</span> Continue with Google</button><button className="guest-button" onClick={guestSignIn}>Continue as guest on this device</button>{accountError && <small className="account-error">{accountError}</small>}</div>}
          {account && !account.isGuest && <div className="signed-in-note"><strong>Signed in as {account.name}</strong><span>Your new workouts will save to this account.</span></div>}
        </div>
        <div className="workout-preview">
          <div className="preview-top"><span>JC / 001</span><span>40 MIN</span></div><p className="preview-label">TODAY&apos;S WORK</p><h2>Range under<br/>pressure.</h2>
          <div className="court-mark" aria-hidden="true"><span></span></div>
          <div className="preview-stats"><div><strong>7</strong><span>DRILLS</span></div><div><strong>70</strong><span>3PT ATT.</span></div><div><strong>L</strong><span>FINISH HAND</span></div></div>
          <div className="preview-focus"><b>FOCUS 01</b><span>Five-spot calibration</span><small>10:00</small></div>
        </div>
      </section>
      <section className="proof-strip"><div className="shell proof-grid"><span>01</span><p><b>Tell us your game.</b><br/>Position, goals, resources.</p><span>02</span><p><b>Put in the work.</b><br/>A focused 30–45 minute plan.</p><span>03</span><p><b>Track what matters.</b><br/>Makes, attempts, next focus.</p></div></section>
      <section className="marketing-problem">
        <div className="shell problem-grid">
          <div><p className="eyebrow">THE PROBLEM</p><h2>Good training should not depend on having an expensive trainer.</h2></div>
          <div className="problem-copy"><p>Many young players cannot consistently access private training. The alternative is often a random online workout that does not know their position, goals, weaknesses, equipment, or results.</p><p>JC Works turns that missing context into a plan players can actually use.</p></div>
        </div>
      </section>
      <section className="audience-section shell">
        <div><p className="eyebrow">WHO IT IS FOR</p><h2>Built for players who want their work to match their game.</h2></div>
        <div className="audience-cards"><article><span>HIGH SCHOOL</span><h3>Prepare for the next level.</h3><p>Train with more purpose, track your results, and understand what needs to improve.</p></article><article><span>COLLEGE</span><h3>Make every extra workout count.</h3><p>Build focused sessions around your role, available equipment, and current weaknesses.</p></article></div>
      </section>
      <section className="feature-section">
        <div className="shell"><p className="eyebrow">ONE CONNECTED EXPERIENCE</p><h2>From player information to the next workout.</h2>
          <div className="marketing-features">
            <article><b>01</b><h3>Personalized workouts</h3><p>Position, goals, weaknesses, time, and equipment shape a focused 30–45 minute plan.</p><button onClick={() => setStep('assessment')}>Build a workout →</button></article>
            <article><b>02</b><h3>Film analysis + cues</h3><p>Compare clips, see what changed, and test short on-screen cues tied to the moment.</p><button onClick={() => setStep('film')}>Watch the demo →</button></article>
            <article><b>03</b><h3>Progress that stays useful</h3><p>Record makes and attempts, save sessions, and carry the next focus into future work.</p><button onClick={openHistory}>View saved results →</button></article>
          </div>
        </div>
      </section>
      <section className="difference-section shell">
        <div className="difference-copy"><p className="eyebrow">WHY JC WORKS IS DIFFERENT</p><h2>It connects the reason, the work, and the result.</h2><p>A generic workout stops at a list of drills. JC Works starts with the player, connects feedback to a specific workout, and uses completed results to decide what should come next.</p></div>
        <div className="difference-flow"><div><span>PLAYER</span><strong>Goals + weaknesses</strong></div><i>→</i><div><span>WORK</span><strong>Focused session</strong></div><i>→</i><div><span>RESULT</span><strong>Next priority</strong></div></div>
      </section>
      <section className="marketing-cta">
        <div className="shell"><p className="eyebrow">BUILT AROUND YOUR GAME</p><h2>Start with 90 seconds.<br/>Leave with today&apos;s work.</h2><div><button className="primary" onClick={() => setStep('assessment')}>Try JC Works <span>→</span></button><button className="light-action" onClick={() => setStep('film')}>Explore film analysis</button></div></div>
      </section>
    </>}

    {step === 'assessment' && <section className="assessment shell">
      <div className="assessment-intro"><p className="eyebrow">PLAYER SETUP · 01</p><h1>Let&apos;s build<br/>today&apos;s work.</h1><p>Seven quick choices. We&apos;ll handle the rest.</p><div className="time-badge">≈ 90 SEC</div></div>
      <div className="form-card">
        <div className="field"><label>FIRST NAME</label><input value={playerName} onChange={(event) => setPlayerName(event.target.value)} aria-label="First name" /></div>
        <div className="field"><label>LEVEL</label><div className="choices">{['College','High school','Other'].map((item) => <button key={item} className={level === item ? 'selected' : ''} onClick={() => setLevel(item)}>{item}</button>)}</div></div>
        <div className="field"><label>POSITION</label><div className="choices">{['Guard','Wing','Forward / Post'].map((item) => <button key={item} className={position === item ? 'selected' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div></div>
        <div className="field"><label>TOP TWO GOALS <small>{goals.length}/2</small></label><div className="choices wrap">{goalOptions.map((goal) => <button key={goal} className={goals.includes(goal) ? 'selected' : ''} onClick={() => toggle(goal, goals, setGoals, 2)}>{goal}</button>)}</div></div>
        <div className="field"><label>WHAT DO YOU HAVE?</label><div className="choices wrap">{equipmentOptions.map((item) => <button key={item} className={equipment.includes(item) ? 'selected' : ''} onClick={() => toggle(item, equipment, setEquipment)}>{item}</button>)}</div></div>
        <div className="field"><label>TIME TODAY</label><div className="duration">{[30,35,40,45].map((time) => <button key={time} className={duration === time ? 'selected' : ''} onClick={() => setDuration(time)}><b>{time}</b><span>MIN</span></button>)}</div></div>
        <div className="field"><label>BIGGEST WEAKNESS</label><input value={weakness} onChange={(event) => setWeakness(event.target.value)} aria-label="Biggest weakness" /></div>
        <button className="primary wide" disabled={goals.length === 0} onClick={generateWorkout}>Generate my workout <span>→</span></button>
      </div>
    </section>}

    {step === 'workout' && <section className="workout shell">
      <header className="workout-header"><div><p className="eyebrow">{playerName.toUpperCase() || 'PLAYER'} · TODAY&apos;S SESSION</p><h1>Range under pressure.</h1><p>A {duration}-minute {position.toLowerCase()} workout built for 3-point consistency and better finishes.</p></div><div className="workout-meta"><strong>{totalMinutes}</strong><span>MINUTES</span><strong>7</strong><span>DRILLS</span></div></header>
      <div className="drill-list">{workout.map((drill, index) => <article className="drill" key={drill.name}><div className="drill-number">{String(index + 1).padStart(2, '0')}</div><div className="drill-main"><p>{drill.minutes} MIN · {index < 2 ? 'PREP' : index < 4 ? 'SHOOTING' : 'FINISHING'}</p><h2>{drill.name}</h2><span>{drill.target}</span><blockquote>COACH CUE — {drill.cue}</blockquote></div><div className="log"><label>MAKES<input type="number" min="0" value={results[index]?.makes ?? ''} onChange={(e) => updateResult(index, 'makes', Number(e.target.value))}/></label><label>ATTEMPTS<input type="number" min="0" value={results[index]?.attempts ?? ''} onChange={(e) => updateResult(index, 'attempts', Number(e.target.value))}/></label></div></article>)}</div>
      <button className="primary finish" onClick={finishWorkout}>Finish and save session <span>→</span></button>
    </section>}

    {step === 'summary' && <section className="summary shell"><p className="eyebrow">SESSION COMPLETE</p><h1>Work logged.<br/><em>Next focus found.</em></h1><p className={`save-note ${saveStatus}`}>{saveStatus === 'saving' ? 'Saving your workout…' : saveStatus === 'saved' ? 'Workout saved to your player history.' : saveStatus === 'error' ? 'Workout shown below. Firebase setup is still needed before it can save permanently.' : ''}</p><div className="summary-grid"><div className="score"><strong>{totals.attempts ? Math.round((totals.makes / totals.attempts) * 100) : '—'}<small>%</small></strong><span>OVERALL SHOOTING</span><p>{totals.makes} makes / {totals.attempts} attempts</p></div><div className="next-focus"><span>NEXT SESSION · PRIORITY 01</span><h2>Corner consistency under fatigue.</h2><p>We&apos;ll add a late-workout corner series and keep weak-hand finishing in your plan.</p></div></div>{history.length > 0 && <div className="history"><div><p className="eyebrow">SAVED HISTORY</p><h2>Your recent workouts</h2></div><div className="history-list">{history.map((item) => <article key={item.id}><strong>{item.percentage ?? '—'}%</strong><span>{item.makes}/{item.attempts} shooting</span><small>{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : 'Just saved'}</small></article>)}</div></div>}<button className="primary" onClick={() => { setResults({}); setSaveStatus('idle'); setStep('assessment'); }}>Build another workout <span>→</span></button></section>}

    {step === 'history' && <section className="results-page shell">
      <div className="results-heading"><div><p className="eyebrow">PLAYER HISTORY</p><h1>Saved results.</h1><p>{account && !account.isGuest ? 'Your completed workouts, available whenever you sign in.' : 'Every completed workout saved to this device.'}</p></div><button className="primary" onClick={() => setStep('assessment')}>Build a workout <span>→</span></button></div>
      {historyStatus === 'loading' && <div className="results-message">Loading your saved workouts…</div>}
      {historyStatus === 'error' && <div className="results-message error">We couldn&apos;t load saved results. Please refresh and try again.</div>}
      {historyStatus === 'loaded' && history.length === 0 && <div className="results-message"><h2>No saved workouts yet.</h2><p>Complete your first workout and your results will appear here.</p></div>}
      {history.length > 0 && <div className="results-table"><div className="results-row results-labels"><span>Date</span><span>Score</span><span>Shooting</span><span>Time</span><span>Next focus</span></div>{history.map((item) => <article className="results-row" key={item.id}><strong>{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : 'Recent'}</strong><b>{item.percentage ?? '—'}%</b><span>{item.makes} makes / {item.attempts} attempts</span><span>{item.duration} min</span><span>{item.focus || 'Keep building consistency'}</span></article>)}</div>}
    </section>}

    {step === 'film' && <section className="film-page">
      <div className="film-hero shell"><div className="film-intro"><p className="eyebrow">FILM ANALYSIS · WORKING DEMO</p><h1>Your film.<br/><em>Your next move.</em></h1><p>JC Works compares the result, explains the clearest difference, and turns that feedback into the next workout.</p><div className="film-actions"><button className="primary" onClick={() => document.getElementById('cue-demo')?.scrollIntoView({ behavior: 'smooth' })}>Watch cue demo <span>↓</span></button><small>Real prototype clips · On-screen cues are an early test</small></div></div><div className="film-flow"><p>FILM → FEEDBACK → WORK</p><div><strong>01</strong><span>Review the clip</span></div><div><strong>02</strong><span>Show a short cue at the right moment</span></div><div><strong>03</strong><span>Build the next training focus</span></div></div></div>
      <div className="cue-demo shell" id="cue-demo">
        <div className="cue-demo-heading"><div><p className="eyebrow">ON-SCREEN CUE TEST</p><h2>See the direction while the clip plays.</h2></div><div className="clip-tabs"><button className={filmClip === 'make' ? 'active' : ''} onClick={() => { setFilmClip('make'); setFilmTime(0); }}>Made shot</button><button className={filmClip === 'miss' ? 'active' : ''} onClick={() => { setFilmClip('miss'); setFilmTime(0); }}>Missed shot</button></div></div>
        <div className="cue-video-layout">
          <div className="pose-tracking-column"><PoseTracker clip={filmClip} cue={currentFilmCue} onTimeChange={updateFilmTime} onSummaryChange={updatePoseSummary}/></div>
          <aside><span>{filmClip === 'make' ? 'VIDEO 1 · MADE' : 'VIDEO 2 · MISSED'}</span><h3>{filmClip === 'make' ? 'Balanced rise. Centered finish.' : 'The shooting hand drifted right.'}</h3><p>{filmClip === 'make' ? 'The make shows a balanced base, full arm extension, and a finish held toward the middle of the rim.' : 'On the miss, the shooting hand moved to the right before coming back toward the center. That late correction matched the ball missing to the right.'}</p></aside>
        </div>
        <div className="pose-comparison">
          <div className="pose-comparison-heading"><div><p className="eyebrow">MEDIAPIPE COMPARISON</p><h3>Make versus miss.</h3></div><p>{trackedDifference}</p></div>
          <div className="pose-comparison-grid">
            <div><span>DEEPEST KNEE ANGLE</span><strong>{makePose ? `${Math.round(makePose.minKneeAngle)}°` : 'Play make'}</strong><small>MADE SHOT</small><strong>{missPose ? `${Math.round(missPose.minKneeAngle)}°` : 'Play miss'}</strong><small>MISSED SHOT</small></div>
            <div><span>MAX ELBOW EXTENSION</span><strong>{makePose ? `${Math.round(makePose.maxElbowAngle)}°` : 'Play make'}</strong><small>MADE SHOT</small><strong>{missPose ? `${Math.round(missPose.maxElbowAngle)}°` : 'Play miss'}</strong><small>MISSED SHOT</small></div>
            <div><span>WRIST LIFT ABOVE SHOULDER</span><strong>{makePose ? `${Math.round(makePose.maxWristLift * 100)}%` : 'Play make'}</strong><small>MADE SHOT</small><strong>{missPose ? `${Math.round(missPose.maxWristLift * 100)}%` : 'Play miss'}</strong><small>MISSED SHOT</small></div>
          </div>
          <small className="pose-disclaimer">Early measurement prototype. The comparison uses the visible movement in each clip and focuses on differences the video can clearly show.</small>
        </div>
      </div>
      <div className="stance-guide shell">
        <div className="stance-visual"><img src="/correct-free-throw-stance.jpg" alt="Jordana demonstrating a balanced free-throw load position"/><span>CORRECT STANCE · MADE SHOT</span></div>
        <div className="stance-copy"><p className="eyebrow">CUE + CORRECT STANCE</p><h2>What the cue should look like.</h2><p>This turns a short cue into something a player can see and copy before the next rep.</p><div className="stance-points"><article><b>01</b><div><strong>Balanced base</strong><span>Feet set under the body with weight centered.</span></div></article><article><b>02</b><div><strong>Soft knee bend</strong><span>Load through the legs without leaning forward.</span></div></article><article><b>03</b><div><strong>Ball centered</strong><span>Bring the ball up on the same middle line as the finish.</span></div></article></div><blockquote>JC WORKS CUE — Straight up, straight through.</blockquote></div>
      </div>
      <div className="film-report shell"><div className="report-heading"><div><p className="eyebrow">FILM TO WORKOUT</p><h2>One clear finding becomes a focused plan.</h2></div><span>EARLY PROTOTYPE · HUMAN CHECK INCLUDED</span></div><div className="report-grid"><article className="tendency-card featured"><small>VISIBLE DIFFERENCE</small><strong>01</strong><h3>Shooting hand moved right</h3><p>On the miss, the shooting hand drifted right before returning toward the center.</p><b>RESULT · THE BALL MISSED RIGHT</b></article><article className="tendency-card"><small>COACHING DIRECTION</small><strong>02</strong><h3>Center the hand earlier</h3><p>Keep the shooting hand on the middle line from the start of the release through the finish.</p><b>CUE · STRAIGHT UP, STRAIGHT THROUGH</b></article><article className="tendency-card"><small>NEXT WORKOUT</small><strong>12</strong><h3>Minute free-throw reset</h3><p>Five finish freezes, ten center-line free throws, right-miss tracking, and one final refilm.</p><b>WORKOUT · 4 FOCUSED BLOCKS</b></article></div></div>
      <div className="membership shell"><div className="membership-copy"><p className="eyebrow">PREVIEW PRICING</p><h2>A film membership that keeps training connected.</h2><p>These options are being tested. Players would only pay once real uploads and verified reports are available.</p></div><div className="plans"><article><span>FILM STARTER</span><strong>$9<small>/mo</small></strong><ul><li>1 film breakdown each month</li><li>Tendencies with timestamps</li><li>1 film-based workout</li><li>Saved report history</li></ul><button onClick={() => setFilmInterest(true)}>Choose Starter</button></article><article className="plan-featured"><span>FILM PRO</span><strong>$19<small>/mo</small></strong><ul><li>4 film breakdowns each month</li><li>Compare trends across clips</li><li>Updated workouts after every report</li><li>Priority film queue</li></ul><button onClick={() => setFilmInterest(true)}>Choose Pro</button></article></div></div>
      <div className="film-note shell"><strong>AI does not get the final word.</strong><p>Early reports will be checked against the player&apos;s own experience and feedback from a coach or knowledgeable reviewer.</p></div>
    </section>}
  </main>;
}
