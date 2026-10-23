/* Study mode: trial sequence, phase timing, scoring and the trial CSV.
   Phases: configured → cue_loading → cue → start_loading → armed → active → complete / aborted. */
(function (root, factory) {
  'use strict';
  var log = root && root.SM2291Log ? root.SM2291Log : require('./interaction-log.js');
  var api = factory(root, log.toCSV);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SM2291Study = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, toCSV) {
  'use strict';
  var COLUMNS = [
    'participant_id', 'session_number', 'trial_number', 'condition', 'task_id', 'precision',
    'start_time_iso', 'end_time_iso', 'duration_ms', 'task_ready_time_iso', 'task_elapsed_ms',
    'outcome', 'correct', 'temporal_error_sec', 'end_selected_time_sec',
    'target_time_sec', 'acceptable_times_json', 'tolerance_sec',
    'mode_switch_count', 'fine_entry_count', 'actual_frame_time_sec', 'preview_pending', 'reason'
  ];
  var UNFINISHED = ['cue_loading', 'cue', 'start_loading', 'armed', 'active'];

  function distance(time, acceptable) {
    return Math.min.apply(null, acceptable.map(function (target) { return Math.abs(time - target); }));
  }
  function elapsed(end, start) { return Math.round(Math.max(0, end - start) * 1000) / 1000; }

  // Fill in defaults and pick a start position far from every accepted time.
  function normalizedConfig(input) {
    var duration = input.mediaDurationSec;
    var relaxed = input.relaxedToleranceSec, precise = input.preciseToleranceSec;
    if (precise > relaxed) throw new RangeError('Precise tolerance must not exceed relaxed tolerance');
    var targets = input.targets.map(function (target, index) {
      var acceptable = Array.from(new Set([target.targetTimeSec].concat(target.acceptableTimesSec || [])))
        .sort(function (a, b) { return a - b; });
      if (acceptable.some(function (t) { return t > duration; })) throw new RangeError('Target times must be within the video');
      var start = target.startTimeSec;
      if (start == null) {
        start = [0, .1, .25, .5, .75, .9, 1].map(function (f) { return f * duration; })
          .reduce(function (best, t) { return distance(t, acceptable) > distance(best, acceptable) ? t : best; });
      }
      if (distance(start, acceptable) <= relaxed) throw new RangeError('Starting position is already inside an acceptable target range');
      return { id: target.id || 'T' + (index + 1), targetTimeSec: target.targetTimeSec, acceptableTimesSec: acceptable, startTimeSec: start };
    });
    return {
      participantId: input.participantId || 'DEMO', cueDurationMs: input.cueDurationMs,
      relaxedToleranceSec: relaxed, preciseToleranceSec: precise,
      firstCondition: input.firstCondition, firstPrecision: input.firstPrecision, targets: targets
    };
  }

  // Each scene: both precision levels, each run under both conditions in alternation.
  function buildPlan(config, sessionNumber) {
    var conditions = config.firstCondition === 'baseline' ? ['baseline', 'dual'] : ['dual', 'baseline'];
    var precisions = config.firstPrecision === 'precise' ? ['precise', 'relaxed'] : ['relaxed', 'precise'];
    var plan = [];
    config.targets.forEach(function (target) {
      precisions.forEach(function (precision) {
        conditions.forEach(function (condition) {
          plan.push({
            taskId: target.id, trialNumber: plan.length + 1, sessionNumber: sessionNumber,
            condition: condition, precision: precision,
            toleranceSec: precision === 'relaxed' ? config.relaxedToleranceSec : config.preciseToleranceSec,
            targetTimeSec: target.targetTimeSec, acceptableTimesSec: target.acceptableTimesSec,
            startTimeSec: target.startTimeSec
          });
        });
      });
    });
    return plan;
  }

  function create(options) {
    options = options || {};
    var now = options.now || function () { return root.performance.now(); };
    var isoNow = options.isoNow || function () { return new Date().toISOString(); };
    var sessionNumber = 0, config = null, plan = [], index = -1;
    var phase = 'idle', timing = null, records = [];

    function trial() { return plan[index] || null; }
    function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

    // Each phase step only succeeds from the expected previous phase.
    function step(from, to, field) {
      if (phase !== from) return false;
      timing[field] = now(); timing[field + 'ISO'] = isoNow(); phase = to;
      return true;
    }

    function beginSession(input) {
      if (phase !== 'idle' && phase !== 'finished') return false;
      config = normalizedConfig(input);
      sessionNumber += 1;
      plan = buildPlan(config, sessionNumber); index = -1; timing = null; phase = 'configured';
      return true;
    }
    function nextTrial() {
      if (!['configured', 'complete', 'aborted'].includes(phase)) return null;
      index += 1;
      if (index >= plan.length) { phase = 'finished'; timing = null; return null; }
      timing = { readyISO: '', startISO: '' };
      phase = 'cue_loading';
      return copy(trial());
    }
    function cueHidden() {
      if (phase !== 'cue' || now() - timing.cueShown < config.cueDurationMs) return false;
      phase = 'start_loading';
      return true;
    }

    function record(details, cancelled, reason) {
      var end = now(), current = trial();
      var error = cancelled ? '' : distance(details.selectedTimeSec, current.acceptableTimesSec);
      var correct = cancelled ? '' : error <= current.toleranceSec;
      var row = {
        participant_id: config.participantId, session_number: sessionNumber,
        trial_number: current.trialNumber, condition: current.condition,
        task_id: current.taskId, precision: current.precision,
        start_time_iso: timing.startISO, end_time_iso: isoNow(),
        duration_ms: timing.start == null ? '' : elapsed(end, timing.start),
        task_ready_time_iso: timing.readyISO,
        task_elapsed_ms: timing.ready == null ? '' : elapsed(end, timing.ready),
        outcome: cancelled ? 'cancelled' : correct ? 'correct' : 'incorrect',
        correct: correct, temporal_error_sec: error,
        end_selected_time_sec: details.selectedTimeSec,
        target_time_sec: current.targetTimeSec,
        acceptable_times_json: JSON.stringify(current.acceptableTimesSec),
        tolerance_sec: current.toleranceSec,
        mode_switch_count: details.modeSwitchCount || 0, fine_entry_count: details.fineEntryCount || 0,
        actual_frame_time_sec: details.actualFrameTimeSec, preview_pending: details.previewPending,
        reason: cancelled ? reason || 'cancel' : 'release'
      };
      records.push(row);
      phase = cancelled ? 'aborted' : 'complete';
      return Object.assign({}, row);
    }
    function cancel(reason, details) { return UNFINISHED.includes(phase) ? record(details || {}, true, reason) : null; }

    return {
      beginSession: beginSession,
      nextTrial: nextTrial,
      cueShown: function () { return step('cue_loading', 'cue', 'cueShown'); },
      cueHidden: cueHidden,
      arm: function () { return step('start_loading', 'armed', 'ready'); },
      start: function () { return step('armed', 'active', 'start'); },
      finish: function (details) { return phase === 'active' ? record(details, false) : null; },
      cancel: cancel,
      exit: function (reason, details) {
        var row = cancel(reason || 'exit', details);
        config = null; plan = []; index = -1; timing = null; phase = 'idle';
        return row;
      },
      // What the UI may show; never includes target or start times.
      state: function () {
        var current = trial();
        return {
          phase: phase, sessionNumber: sessionNumber,
          trialNumber: current ? current.trialNumber : phase === 'finished' ? plan.length : 0,
          total: plan.length, condition: current ? current.condition : null, precision: current ? current.precision : null,
          cueRemainingMs: phase === 'cue' ? Math.max(0, Math.ceil(config.cueDurationMs - (now() - timing.cueShown))) : 0
        };
      },
      currentTrial: function () { return copy(trial()); },
      rows: function () { return records.map(function (row) { return Object.assign({}, row); }); },
      toCSV: function () { return toCSV(COLUMNS, records); }
    };
  }
  return { create: create };
}));
