import { verifyRevisionUrls } from './deployment-revision.mjs';

const urls = (process.env.VERIFY_URLS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const verified = await verifyRevisionUrls({
  attempts: process.env.VERIFY_ATTEMPTS,
  delayMs: process.env.VERIFY_DELAY_MS,
  expectedSha: process.env.EXPECTED_SHA,
  field: process.env.REVISION_FIELD,
  urls,
});

console.log(`Verified revision ${process.env.EXPECTED_SHA} at ${verified.join(', ')}.`);
