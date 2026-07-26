import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  requiredCommit,
  staticSurfaces,
  verifyRevisionUrls,
  writeStaticVersions,
} from './deployment-revision.mjs';

const commit = '1234567890abcdef1234567890abcdef12345678';
const builtAt = '2026-07-26T14:00:00.000Z';
const root = await mkdtemp(join(tmpdir(), 'traverse-static-revision-'));

try {
  for (const surface of staticSurfaces) {
    const distDirectory = join(root, 'apps', surface, 'dist');
    await mkdir(distDirectory, { recursive: true });
    await writeFile(join(distDirectory, 'index.html'), '<!doctype html>\n', 'utf8');
  }

  const result = await writeStaticVersions({ builtAt, commit, root });
  assert.deepEqual(result, { builtAt, commit, surfaces: staticSurfaces });

  for (const surface of staticSurfaces) {
    const manifest = JSON.parse(
      await readFile(join(root, 'apps', surface, 'dist', 'version.json'), 'utf8'),
    );
    assert.deepEqual(manifest, { builtAt, commit });
  }

  assert.equal(requiredCommit(commit), commit);
  assert.throws(() => requiredCommit('not-a-commit'), /40-character lowercase Git commit SHA/);

  const url = 'https://staging.example.invalid/version.json';
  const fetchImplementation = async () =>
    new Response(JSON.stringify({ commit, revision: commit }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });

  assert.deepEqual(
    await verifyRevisionUrls({
      attempts: 1,
      delayMs: 0,
      expectedSha: commit,
      fetchImplementation,
      field: 'commit',
      urls: [url],
    }),
    [url],
  );
  assert.deepEqual(
    await verifyRevisionUrls({
      attempts: 1,
      delayMs: 0,
      expectedSha: commit,
      fetchImplementation,
      field: 'revision',
      urls: [url],
    }),
    [url],
  );
} finally {
  await rm(root, { force: true, recursive: true });
}

console.log('Deployment revision evidence tests passed.');
