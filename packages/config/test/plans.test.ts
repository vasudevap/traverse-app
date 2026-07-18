import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_CODES, PLAN_DISPLAY_NAMES } from '../src/index.js';

test('TRA-44 preserves stable plan codes while exposing Basic, Pro, and Premium labels', () => {
  assert.deepEqual(PLAN_CODES, ['starter', 'practice', 'established']);
  assert.deepEqual(PLAN_DISPLAY_NAMES, {
    starter: 'Basic',
    practice: 'Pro',
    established: 'Premium',
  });
});
