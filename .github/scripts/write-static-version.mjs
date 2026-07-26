import { writeStaticVersions } from './deployment-revision.mjs';

const result = await writeStaticVersions({
  builtAt: process.env.TRAVERSE_BUILD_AT,
  commit: process.env.TRAVERSE_BUILD_SHA,
  root: process.env.TRAVERSE_STATIC_ROOT,
});

console.log(`Wrote ${result.commit} to ${result.surfaces.length} static application manifests.`);
