const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../interaction-log.js');

function fixture() {
  let ms = 100;
  let iso = '2026-10-11T14:00:00.000Z';
  return {
    log: create({ now: () => ms, isoNow: () => iso }),
    setTime(value) { ms = value; },
    setISO(value) { iso = value; }
  };
}

function context(overrides = {}) {
  return { participantId: 'DEMO', condition: 'dual', mediaTitle: '真實影片', mediaDurationSec: 237.916667, selectedTimeSec: 30, ...overrides };
}

// Parse quoted CSV so commas, quotes and embedded CR/LF are verified as data, not line splits.
function parseCSV(csv) {
  const data = csv.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i];
    if (ch === '"') {
      if (quoted && data[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (ch === '\r' && data[i + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; i += 1;
    } else cell += ch;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  return rows;
}

test('release stores one unscored interaction at the release instant, including pending preview', () => {
  const f = fixture();
  assert.equal(f.log.begin(context()), true);
  assert.equal(f.log.isActive(), true);
  f.setTime(1350.125);
  f.setISO('2026-10-11T14:00:01.250Z');
  const row = f.log.finish({ selectedTimeSec: 46.5, actualFrameTimeSec: 45, previewPending: true, reason: 'release' });
  assert.equal(row.duration_ms, 1250.125);
  assert.equal(row.start_selected_time_sec, 30);
  assert.equal(row.end_selected_time_sec, 46.5);
  assert.equal(row.actual_frame_time_sec, 45);
  assert.equal(row.preview_pending, true);
  assert.equal(row.result_status, 'released');
  assert.equal(row.reason, 'release');
  assert.equal(row.outcome, 'not_scored');
  assert.equal(row.record_type, 'interaction');
  assert.equal(row.interaction_number, 1);
  assert.equal(f.log.isActive(), false);
});

test('release then lost capture/cancel cannot create duplicates; active begin is rejected', () => {
  const f = fixture();
  f.log.begin(context());
  assert.equal(f.log.begin(context({ condition: 'baseline', participantId: 'other' })), false);
  f.log.finish({ selectedTimeSec: 35 });
  assert.equal(f.log.cancel({ selectedTimeSec: 35, reason: 'lostpointercapture' }), null);
  assert.equal(f.log.finish({ selectedTimeSec: 35 }), null);
  assert.equal(f.log.rows().length, 1);
  f.log.begin(context({ condition: 'baseline' }));
  const second = f.log.finish({ selectedTimeSec: 40, previewPending: false });
  assert.equal(second.interaction_number, 2);
  assert.equal(second.condition, 'baseline');
});

test('cancel records abort cause and snapshots mutable begin metadata', () => {
  const f = fixture();
  const initial = context({ participantId: '一人' });
  f.log.begin(initial);
  initial.participantId = 'changed'; initial.mediaTitle = 'changed'; initial.condition = 'baseline';
  f.setTime(175);
  const row = f.log.cancel({ selectedTimeSec: 31, actualFrameTimeSec: 30.9, previewPending: true, reason: 'window-blur' });
  assert.equal(row.participant_id, '一人');
  assert.equal(row.media_title, '真實影片');
  assert.equal(row.condition, 'dual');
  assert.equal(row.duration_ms, 75);
  assert.equal(row.result_status, 'aborted');
  assert.equal(row.reason, 'window-blur');
  row.condition = 'tampered';
  const readback = f.log.rows(); readback[0].participant_id = 'tampered'; readback.push({});
  assert.equal(f.log.rows()[0].condition, 'dual');
  assert.equal(f.log.rows()[0].participant_id, '一人');
  assert.equal(f.log.rows().length, 1);
});

test('only real coarse/fine transitions count; local window stores last fine entry', () => {
  const f = fixture(); f.log.begin(context());
  assert.equal(f.log.switchMode({ from: 'fine', to: 'coarse', selectedTimeSec: 30 }), false);
  assert.equal(f.log.switchMode({ from: 'coarse', to: 'coarse', selectedTimeSec: 30 }), false);
  assert.equal(f.log.switchMode({ from: 'coarse', to: 'fine', selectedTimeSec: 50, windowStartSec: 20, windowEndSec: 80 }), true);
  assert.equal(f.log.switchMode({ from: 'coarse', to: 'fine', selectedTimeSec: 50 }), false);
  f.log.switchMode({ from: 'fine', to: 'coarse', selectedTimeSec: 70 });
  f.log.switchMode({ from: 'coarse', to: 'fine', selectedTimeSec: 100, windowStartSec: 70, windowEndSec: 130 });
  const row = f.log.finish({ selectedTimeSec: 110 });
  assert.equal(row.mode_switch_count, 3);
  assert.equal(row.fine_entry_count, 2);
});

test('CSV keeps CJK, commas and quotes with BOM/CRLF; empty ID defaults to DEMO', () => {
  const f = fixture();
  f.log.begin(context({ participantId: '中文"ID",一' })); f.log.finish({ selectedTimeSec: 60, previewPending: false });
  f.log.begin(context({ participantId: '' })); f.log.finish({ selectedTimeSec: 30 });
  const csv = f.log.toCSV();
  assert.equal(csv.charCodeAt(0), 0xFEFF); assert.ok(csv.endsWith('\r\n'));
  const [headers, first, second] = parseCSV(csv);
  const id = headers.indexOf('participant_id');
  assert.equal(first[id], '中文"ID",一'); assert.equal(second[id], 'DEMO');
  assert.equal(first[headers.indexOf('outcome')], 'not_scored');
  assert.equal(first[headers.indexOf('preview_pending')], 'false');
});
