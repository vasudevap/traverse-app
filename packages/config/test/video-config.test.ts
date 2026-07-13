import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadVideoConfig, VIDEO_DEFAULTS } from '../src/index';

test('video config uses the V15 defaults', () => {
  assert.deepEqual(loadVideoConfig({}), VIDEO_DEFAULTS);
});

test('video config accepts validated environment overrides', () => {
  assert.deepEqual(
    loadVideoConfig({
      TRAVERSE_VIDEO_MAX_SECONDS_COACH: '240',
      TRAVERSE_VIDEO_MAX_SECONDS_CLIENT: '120',
      TRAVERSE_VIDEO_UNDO_WINDOW_SECONDS: '15',
    }),
    { maxSecondsCoach: 240, maxSecondsClient: 120, undoWindowSeconds: 15 },
  );
});

test('video config rejects non-positive and non-integer values', () => {
  assert.throws(
    () => loadVideoConfig({ TRAVERSE_VIDEO_MAX_SECONDS_COACH: '0' }),
    /expected a positive integer/,
  );
  assert.throws(
    () => loadVideoConfig({ TRAVERSE_VIDEO_UNDO_WINDOW_SECONDS: '1.5' }),
    /expected a positive integer/,
  );
});

test('video config rejects a client cap above the coach cap', () => {
  assert.throws(
    () =>
      loadVideoConfig({
        TRAVERSE_VIDEO_MAX_SECONDS_COACH: '60',
        TRAVERSE_VIDEO_MAX_SECONDS_CLIENT: '90',
      }),
    /client cap cannot exceed coach cap/,
  );
});
