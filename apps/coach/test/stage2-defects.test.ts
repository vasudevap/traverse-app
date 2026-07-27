import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesheet = readFile(new URL('../src/index.css', import.meta.url), 'utf8');

test('TRA-95, TRA-98, and TRA-101 keep setup controls on the shared alignment contract', async () => {
  const [source, css] = await Promise.all([appSource, stylesheet]);

  for (const label of ['Invitation expires after', 'Timezone', 'Refund approach']) {
    assert.match(source, new RegExp(`<Field(?: hint="[^"]*")? label="${label}">`));
  }
  assert.match(css, /\.setup-form__grid > \.trv-field\s*\{\s*align-content: start;/);
  assert.match(css, /\.setup-form__grid \.trv-input\s*\{\s*width: 100%;/);
  assert.match(
    css,
    /\.setup-select\s*\{[\s\S]*?display: block;[\s\S]*?height: 42px;[\s\S]*?width: 100%;/,
  );
});

test('TRA-100 clears a step-scoped setup error before navigating', async () => {
  assert.match(
    await appSource,
    /onNavigate=\{\(step\) => \{\s*setError\(null\);\s*setActiveStep\(step\);\s*\}\}/,
  );
});
