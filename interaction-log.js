/* Free-play interaction log (not scored) and the shared CSV writer. Data stays in memory. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SM2291Log = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var COLUMNS = [
    'record_type', 'participant_id', 'condition', 'interaction_number',
    'start_time_iso', 'end_time_iso', 'duration_ms', 'media_title',
    'start_selected_time_sec', 'end_selected_time_sec', 'actual_frame_time_sec',
    'preview_pending', 'mode_switch_count', 'fine_entry_count', 'result_status', 'reason', 'outcome'
  ];

  // UTF-8 BOM so Excel opens Chinese text correctly; every cell is quoted.
  function toCSV(columns, rows) {
    var cell = function (value) { return '"' + (value == null ? '' : String(value)).replace(/"/g, '""') + '"'; };
    var lines = [columns.map(cell).join(',')];
    rows.forEach(function (row) { lines.push(columns.map(function (key) { return cell(row[key]); }).join(',')); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function create(options) {
    options = options || {};
    var now = options.now || function () { return root.performance.now(); };
    var isoNow = options.isoNow || function () { return new Date().toISOString(); };
    var records = [], active = null, sequence = 0;

    function begin(context) {
      if (active) return false;
      sequence += 1;
      active = {
        started: now(), mode: 'coarse',
        row: {
          record_type: 'interaction', participant_id: context.participantId || 'DEMO',
          condition: context.condition, interaction_number: sequence,
          start_time_iso: isoNow(), media_title: context.mediaTitle || '',
          start_selected_time_sec: context.selectedTimeSec,
          mode_switch_count: 0, fine_entry_count: 0, outcome: 'not_scored'
        }
      };
      return true;
    }

    function switchMode(change) {
      if (!active || change.from !== active.mode || change.to === active.mode) return false;
      active.mode = change.to;
      active.row.mode_switch_count += 1;
      if (change.to === 'fine') active.row.fine_entry_count += 1;
      return true;
    }

    function complete(details, status) {
      if (!active) return null;
      var row = Object.assign({}, active.row, {
        end_time_iso: isoNow(),
        duration_ms: Math.round(Math.max(0, now() - active.started) * 1000) / 1000,
        end_selected_time_sec: details.selectedTimeSec,
        actual_frame_time_sec: details.actualFrameTimeSec,
        preview_pending: details.previewPending,
        result_status: status,
        reason: status === 'released' ? 'release' : details.reason || 'cancel'
      });
      active = null;
      records.push(row);
      return Object.assign({}, row);
    }

    return {
      begin: begin,
      switchMode: switchMode,
      finish: function (details) { return complete(details || {}, 'released'); },
      cancel: function (details) { return complete(details || {}, 'aborted'); },
      rows: function () { return records.map(function (row) { return Object.assign({}, row); }); },
      toCSV: function () { return toCSV(COLUMNS, records); },
      isActive: function () { return active !== null; }
    };
  }

  return { create: create, toCSV: toCSV };
}));
