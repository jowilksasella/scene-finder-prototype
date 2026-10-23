const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../trial-engine.js');

function fixture() {
  let time = 0, iso = '2026-10-11T16:00:00.000Z';
  return { engine: create({ now: () => time, isoNow: () => iso }),
    at(ms) { time = ms; }, iso(value) { iso = value; } };
}
function config(overrides = {}) {
  return { participantId: 'QA-UNIT', mediaTitle: '真實短片', mediaDurationSec: 200,
    cueDurationMs: 5000, relaxedToleranceSec: 5, preciseToleranceSec: 2,
    targets: [{ id: 'T1', targetTimeSec: 60 }, { id: 'T2', targetTimeSec: 110 }],
    firstCondition: 'dual', firstPrecision: 'relaxed', ...overrides };
}
function prepare(f, options = {}) {
  assert.equal(f.engine.beginSession(config(options)), true);
  assert.ok(f.engine.nextTrial());
  f.at(100); assert.equal(f.engine.cueShown(), true);
  f.at(100 + (options.cueDurationMs ?? 5000)); assert.equal(f.engine.cueHidden(), true);
  assert.equal(f.engine.arm(), true);
}
function parseCSV(csv) {
  const data = csv.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i];
    if (ch === '"') { if (quoted && data[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (ch === '\r' && data[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += ch;
  }
  assert.equal(quoted, false); assert.equal(cell, ''); return rows;
}

test('illegal phase transitions leave idle/configured/loading state untouched', () => {
  const f = fixture(), e = f.engine;
  assert.equal(e.state().phase, 'idle'); assert.equal(e.currentTrial(), null);
  assert.equal(e.nextTrial(), null); assert.equal(e.cueShown(), false);
  assert.equal(e.cueHidden(), false); assert.equal(e.arm(), false); assert.equal(e.start(), false);
  assert.equal(e.finish({ selectedTimeSec: 60 }), null); assert.equal(e.cancel('blur'), null);
  assert.equal(e.beginSession(config()), true); assert.equal(e.start(), false);
  assert.equal(e.beginSession(config()), false); e.nextTrial();
  assert.equal(e.start(), false); assert.equal(e.arm(), false); assert.equal(e.cueHidden(), false);
  assert.equal(e.state().phase, 'cue_loading'); assert.deepEqual(e.rows(), []);
});

test('cue timing starts at explicit loaded-frame callback and cannot finish exposure early', () => {
  const f = fixture(), e = f.engine; e.beginSession(config()); e.nextTrial();
  f.at(9000); assert.equal(e.cueHidden(), false); assert.equal(e.start(), false);
  assert.equal(e.cueShown(), true); assert.equal(e.state().cueRemainingMs, 5000);
  f.at(13999); assert.equal(e.cueHidden(), false); assert.equal(e.state().cueRemainingMs, 1);
  f.at(14000); assert.equal(e.cueHidden(), true); assert.equal(e.state().phase, 'start_loading');
  assert.equal(e.start(), false); f.at(14200); assert.equal(e.arm(), true);
  f.at(14500); assert.equal(e.start(), true); f.at(15300);
  const row = e.finish({ selectedTimeSec: 60, actualFrameTimeSec: 59, previewPending: true });
  assert.equal(row.duration_ms, 800); assert.equal(row.task_elapsed_ms, 1100);
  assert.equal(row.correct, true); assert.equal(row.preview_pending, true); assert.equal(row.actual_frame_time_sec, 59);
});

test('default two-target plan is eight fully crossed trials with alternating conditions', () => {
  const f = fixture(), e = f.engine; e.beginSession(config()); const plan = [];
  while (true) {
    const t = e.nextTrial(); if (!t) break;
    plan.push(t); e.cancel('plan-inspection');
  }
  assert.equal(e.state().phase, 'finished'); assert.equal(e.state().total, 8);
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map(t => t.condition), ['dual', 'baseline', 'dual', 'baseline', 'dual', 'baseline', 'dual', 'baseline']);
  assert.deepEqual(plan.map(t => t.precision), ['relaxed', 'relaxed', 'precise', 'precise', 'relaxed', 'relaxed', 'precise', 'precise']);
  assert.equal(new Set(plan.map(t => [t.taskId, t.precision, t.condition].join(':'))).size, 8);
  assert.deepEqual(plan.map(t => t.trialNumber), [1,2,3,4,5,6,7,8]);
});

test('first condition/precision options reorder without dropping any combination', () => {
  const f = fixture(), e = f.engine; e.beginSession(config({ firstCondition: 'baseline', firstPrecision: 'precise' }));
  const sequence = [];
  for (let i = 0; i < 8; i++) { sequence.push(e.nextTrial()); e.cancel('unit'); }
  assert.equal(sequence[0].condition, 'baseline'); assert.equal(sequence[0].precision, 'precise');
  assert.deepEqual(sequence.slice(0,4).map(t => [t.condition, t.precision]), [
    ['baseline','precise'], ['dual','precise'], ['baseline','relaxed'], ['dual','relaxed']
  ]);
  assert.equal(new Set(sequence.map(t => [t.taskId, t.precision, t.condition].join(':'))).size, 8);
});

test('temporal scoring includes the tolerance boundary and records wrong release without retry', () => {
  const f = fixture(), e = f.engine; e.beginSession(config({ cueDurationMs: 1, targets: [{ id: 'T', targetTimeSec: 60 }] }));
  const selected = [65, 65.0001, 62, 62.0001], expected = [true, false, true, false];
  for (let i = 0; i < 4; i++) {
    e.nextTrial(); f.at(i * 100); e.cueShown(); f.at(i * 100 + 1); e.cueHidden(); e.arm(); e.start();
    const row = e.finish({ selectedTimeSec: selected[i] });
    assert.equal(row.correct, expected[i]); assert.equal(row.outcome, expected[i] ? 'correct' : 'incorrect');
    assert.equal(row.reason, 'release'); assert.equal(e.state().phase, 'complete');
    assert.equal(e.start(), false); assert.equal(e.finish({ selectedTimeSec: 60 }), null);
  }
});

test('nearest approved occurrence is scored and primary target is always in the acceptable set', () => {
  const f = fixture(); prepare(f, { targets: [{ id: 'repeat', targetTimeSec: 60, acceptableTimesSec: [180,120,120] }] });
  assert.deepEqual(f.engine.currentTrial().acceptableTimesSec, [60,120,180]);
  f.engine.start(); const row = f.engine.finish({ selectedTimeSec: 121 });
  assert.equal(row.target_time_sec, 60); assert.equal(row.temporal_error_sec, 1); assert.equal(row.correct, true);
  assert.equal(row.acceptable_times_json, '[60,120,180]');
});

test('default start maximizes nearest-target distance independently of tolerance; configured starts are respected', () => {
  const targets = [{ id: 'R', targetTimeSec: 60, acceptableTimesSec: [180] }];
  const a = fixture().engine, b = fixture().engine;
  a.beginSession(config({ targets, relaxedToleranceSec: 5, preciseToleranceSec: 2 }));
  b.beginSession(config({ targets, relaxedToleranceSec: 20, preciseToleranceSec: 10 }));
  assert.equal(a.nextTrial().startTimeSec, 0); assert.equal(b.nextTrial().startTimeSec, 0);
  const c = fixture().engine; c.beginSession(config({ targets: [{ targetTimeSec: 60, startTimeSec: 120 }] }));
  assert.equal(c.nextTrial().startTimeSec, 120);
  assert.throws(() => fixture().engine.beginSession(config({ targets: [{ targetTimeSec: 60, startTimeSec: 65 }] })), /Starting/);
  assert.throws(() => fixture().engine.beginSession(config({ preciseToleranceSec: 6 })), /Precise/);
});

test('cancel during loading/cue/start-loading/armed leaves correctness and unstarted drag clocks blank', () => {
  for (const wanted of ['cue_loading','cue','start_loading','armed']) {
    const f = fixture(), e = f.engine; e.beginSession(config()); e.nextTrial();
    if (wanted !== 'cue_loading') { f.at(100); e.cueShown(); }
    if (wanted === 'start_loading' || wanted === 'armed') { f.at(5100); e.cueHidden(); }
    if (wanted === 'armed') { f.at(5200); e.arm(); }
    f.at(wanted === 'cue' ? 600 : 5300);
    const row = e.cancel('window-blur', { selectedTimeSec: 60 });
    assert.equal(row.outcome, 'cancelled'); assert.equal(row.correct, '');
    assert.equal(row.start_time_iso, ''); assert.equal(row.duration_ms, ''); assert.equal(row.temporal_error_sec, '');
    assert.equal(row.reason, 'window-blur');
    assert.equal(row.task_elapsed_ms, wanted === 'armed' ? 100 : '');
    assert.equal(e.state().phase, 'aborted'); assert.equal(e.cancel('lostpointercapture'), null);
  }
});

test('active cancellation records elapsed drag/task and never calls it incorrect', () => {
  const f = fixture(); prepare(f); f.at(5300); f.engine.start(); f.at(5800);
  const row = f.engine.cancel('pointercancel', { selectedTimeSec: 120, modeSwitchCount: 3, fineEntryCount: 2, previewPending: true });
  assert.equal(row.duration_ms, 500); assert.equal(row.task_elapsed_ms, 700);
  assert.equal(row.outcome, 'cancelled'); assert.equal(row.correct, ''); assert.equal(row.temporal_error_sec, '');
  assert.equal(row.mode_switch_count, 3); assert.equal(row.fine_entry_count, 2);
  assert.equal(f.engine.finish({ selectedTimeSec: 60 }), null); assert.equal(f.engine.rows().length, 1);
});

test('one release makes one row; late lost-capture/exit never duplicates it', () => {
  const f = fixture(); prepare(f); f.engine.start();
  const row = f.engine.finish({ selectedTimeSec: 60, modeSwitchCount: 2, fineEntryCount: 1 });
  assert.equal(row.mode_switch_count, 2); assert.equal(row.fine_entry_count, 1);
  assert.equal(f.engine.finish({ selectedTimeSec: 60 }), null); assert.equal(f.engine.cancel('lostpointercapture'), null);
  assert.equal(f.engine.exit('exit'), null); assert.equal(f.engine.state().phase, 'idle'); assert.equal(f.engine.rows().length, 1);
});

test('safe state reveals phase/order/countdown but never target or starting times', () => {
  const f = fixture(); f.engine.beginSession(config()); f.engine.nextTrial(); f.engine.cueShown();
  const state = f.engine.state();
  assert.equal(state.condition, 'dual'); assert.equal(state.precision, 'relaxed'); assert.equal(state.total, 8);
  assert.equal(state.trialNumber, 1); assert.equal(state.cueRemainingMs, 5000);
  assert.deepEqual(Object.keys(state), ['phase','sessionNumber','trialNumber','total','condition','precision','cueRemainingMs']);
  assert.ok(!JSON.stringify(state).includes('target')); assert.ok(!JSON.stringify(state).includes('startTime'));
});

test('exit preserves records, new sessions increment session number, and finished plans can be replaced', () => {
  const f = fixture(); prepare(f); f.engine.start(); f.engine.finish({ selectedTimeSec: 60 }); f.engine.exit();
  assert.equal(f.engine.beginSession(config({ participantId: 'SECOND' })), true);
  assert.equal(f.engine.nextTrial().sessionNumber, 2); f.engine.cancel('unit');
  while (f.engine.nextTrial()) f.engine.cancel('unit');
  assert.equal(f.engine.state().phase, 'finished'); assert.equal(f.engine.rows().length, 9);
  assert.equal(f.engine.rows()[0].session_number, 1); assert.equal(f.engine.rows()[1].session_number, 2);
  assert.equal(f.engine.rows()[1].trial_number, 1); assert.equal(f.engine.rows()[1].participant_id, 'SECOND');
  assert.equal(f.engine.beginSession(config()), true); assert.equal(f.engine.state().sessionNumber, 3);
  assert.equal(f.engine.rows().length, 9); assert.deepEqual(create().rows(), []);
});

test('CSV has BOM/CRLF, the required fields, and keeps CJK, quotes and blanks', () => {
  const f = fixture(), id = '中文"ID",一';
  prepare(f, { participantId: id }); f.engine.start(); f.at(5300);
  f.engine.finish({ selectedTimeSec: 60, actualFrameTimeSec: 60, previewPending: false });
  f.engine.nextTrial(); f.engine.cancel('blur');
  const csv = f.engine.toCSV(); assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.endsWith('\r\n'));
  const [headers, values, cancelValues] = parseCSV(csv);
  assert.equal(headers.length, 23); assert.equal(values.length, 23); assert.equal(cancelValues.length, 23);
  for (const key of ['participant_id', 'condition', 'trial_number', 'start_time_iso', 'end_time_iso', 'outcome', 'correct']) assert.ok(headers.includes(key), key);
  const row = Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  const cancelled = Object.fromEntries(headers.map((key, i) => [key, cancelValues[i]]));
  assert.equal(row.participant_id, id); assert.equal(row.correct, 'true'); assert.equal(row.outcome, 'correct');
  assert.equal(row.preview_pending, 'false'); assert.equal(row.acceptable_times_json, '[60]');
  assert.equal(cancelled.correct, ''); assert.equal(cancelled.start_time_iso, ''); assert.equal(cancelled.duration_ms, '');
  assert.equal(cancelled.outcome, 'cancelled');
});
