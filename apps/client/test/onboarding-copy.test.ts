import assert from 'node:assert/strict';
import test from 'node:test';
import { missingIntakeWaitingCopy } from '../src/onboarding-copy.js';

test('TRA-102 gives the Client the approved waiting state while the Coach repairs intake', () => {
  assert.deepEqual(missingIntakeWaitingCopy('Maya Patel'), {
    badge: 'Next step pending',
    body: 'Thank you for accepting your coaching agreement. Maya Patel will be in touch when your next step is ready.',
    support: 'Have a question in the meantime? Please contact your coach.',
    title: "You're all set for now.",
  });
});

test('TRA-102 falls back to a generic Coach reference when a name is unavailable', () => {
  assert.equal(
    missingIntakeWaitingCopy('  ').body,
    'Thank you for accepting your coaching agreement. Your coach will be in touch when your next step is ready.',
  );
});
