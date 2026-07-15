import { readFile } from 'node:fs/promises';

const auditEndpoint = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const failingSeverities = new Set(['high', 'critical']);

function packagesFromLockfile(lockfile) {
  const packagesStart = lockfile.indexOf('\npackages:\n');
  const snapshotsStart = lockfile.indexOf('\nsnapshots:\n');

  if (packagesStart === -1 || snapshotsStart === -1 || snapshotsStart <= packagesStart) {
    throw new Error(
      'pnpm-lock.yaml does not contain the expected packages and snapshots sections.',
    );
  }

  const packages = {};
  const packageEntries = lockfile
    .slice(packagesStart, snapshotsStart)
    .matchAll(/^  (?:'([^']+)'|([^:\s]+)):\n/gm);

  for (const entry of packageEntries) {
    const packageKey = entry[1] ?? entry[2];
    const versionDelimiter = packageKey.lastIndexOf('@');

    if (versionDelimiter <= 0) {
      continue;
    }

    const name = packageKey.slice(0, versionDelimiter);
    const version = packageKey.slice(versionDelimiter + 1);
    packages[name] ??= [];
    packages[name].push(version);
  }

  if (Object.keys(packages).length === 0) {
    throw new Error('No resolved packages were found in pnpm-lock.yaml.');
  }

  return Object.fromEntries(
    Object.entries(packages).map(([name, versions]) => [name, [...new Set(versions)].sort()]),
  );
}

const lockfile = await readFile('pnpm-lock.yaml', 'utf8');
const packages = packagesFromLockfile(lockfile);
const response = await fetch(auditEndpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(packages),
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(`npm bulk advisory request failed: ${response.status} ${response.statusText}`);
}

const advisoriesByPackage = await response.json();
const failingAdvisories = Object.entries(advisoriesByPackage).flatMap(([name, advisories]) =>
  advisories
    .filter((advisory) => failingSeverities.has(advisory.severity))
    .map((advisory) => ({ name, ...advisory })),
);

if (failingAdvisories.length === 0) {
  console.log(
    `No high or critical npm advisories across ${Object.keys(packages).length} resolved packages.`,
  );
} else {
  console.error('High or critical npm advisories found:');
  for (const advisory of failingAdvisories) {
    console.error(`- ${advisory.name}: ${advisory.severity} - ${advisory.title} (${advisory.url})`);
  }
  process.exitCode = 1;
}
