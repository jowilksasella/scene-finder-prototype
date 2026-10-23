# Prototype

Open `index.html` in Chrome or Edge. No build step, framework or server is needed. Optionally run `node serve.cjs` and open `http://127.0.0.1:8291/`. See the [project README](../README.md) for an overview.

## Using the two conditions

- **Dual timeline:** press on the full bar and drag left/right to search coarsely. Keep holding and move down into the fine area: a local bar covering about 60 s around the current position appears and horizontal movement becomes much finer. Move back up to return to coarse mode. Release to stop.
- **Baseline:** press and drag on the full bar. A small live preview follows the cursor; the background frame updates when you release.

Keyboard on the full bar (free play only): ← / → ±1 s, Shift + ← / → ±10 s, Home / End.

## Running a study session

1. Enter a participant ID and open **Task settings**.
2. Set the target time for each scene (defaults are 30 % and 55 % of the video). Add alternative accepted times if the same shot appears more than once. Leave the start time empty to let the program pick a distant one.
3. Press **Start study**. For each trial: the target frame is shown for the cue period, the screen is covered while the player moves to the start position, then the participant presses, searches and releases once.
4. Press **Next trial** to continue. When all trials are finished (or after **Exit study**), export the trial CSV.

A trial is cancelled, not marked wrong, if the window loses focus, is resized or the pointer is interrupted.

## Scoring and timing

- `correct` = the selected time is within the tolerance of the nearest accepted time.
- `duration_ms` = press to release.
- `task_elapsed_ms` = start frame ready to release (includes thinking time before pressing).
- Durations use `performance.now()`; ISO timestamps are for reference.

## Tests

```bash
node tests/trial-engine.test.cjs
```

```bash
node tests/interaction-log.test.cjs
```
