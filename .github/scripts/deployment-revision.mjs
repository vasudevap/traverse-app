import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const staticSurfaces = ['admin', 'billing-admin', 'client', 'coach'];

export function requiredCommit(value, label = 'commit') {
  const commit = value?.trim();
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${label} must be a 40-character lowercase Git commit SHA.`);
  }
  return commit;
}

export async function writeStaticVersions({
  builtAt = new Date().toISOString(),
  commit,
  root = process.cwd(),
} = {}) {
  const requiredSha = requiredCommit(commit, 'TRAVERSE_BUILD_SHA');
  if (!Number.isFinite(Date.parse(builtAt))) {
    throw new Error('TRAVERSE_BUILD_AT must be a valid timestamp when provided.');
  }

  const manifest = `${JSON.stringify({ builtAt, commit: requiredSha }, null, 2)}\n`;

  for (const surface of staticSurfaces) {
    const distDirectory = resolve(root, 'apps', surface, 'dist');
    await access(resolve(distDirectory, 'index.html'));
    await writeFile(resolve(distDirectory, 'version.json'), manifest, 'utf8');
  }

  return { builtAt, commit: requiredSha, surfaces: [...staticSurfaces] };
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export async function verifyRevisionUrls({
  attempts,
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  delayMs,
  expectedSha,
  fetchImplementation = globalThis.fetch,
  field,
  urls,
} = {}) {
  const requiredSha = requiredCommit(expectedSha, 'EXPECTED_SHA');
  if (field !== 'commit' && field !== 'revision') {
    throw new Error('REVISION_FIELD must be either commit or revision.');
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('At least one revision URL is required.');
  }
  if (typeof fetchImplementation !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const maximumAttempts = positiveInteger(attempts, 12, 'VERIFY_ATTEMPTS');
  const retryDelay = nonNegativeInteger(delayMs, 5_000, 'VERIFY_DELAY_MS');
  const verified = [];

  for (const rawUrl of urls) {
    const url = new URL(rawUrl);
    url.searchParams.set('deployment', requiredSha);
    let lastFailure = 'No response received.';

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await fetchImplementation(url, {
          headers: { 'cache-control': 'no-cache' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          lastFailure = `HTTP ${response.status}`;
        } else {
          const body = await response.json();
          if (body?.[field] === requiredSha) {
            verified.push(rawUrl);
            lastFailure = '';
            break;
          }
          lastFailure = `${field} did not match the expected commit`;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      if (attempt < maximumAttempts && retryDelay > 0) {
        await delay(retryDelay);
      }
    }

    if (lastFailure !== '') {
      throw new Error(`Revision verification failed for ${rawUrl}: ${lastFailure}.`);
    }
  }

  return verified;
}
