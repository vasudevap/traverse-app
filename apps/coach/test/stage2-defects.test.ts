import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const stylesheet = readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const clientStylesheet = readFile(new URL('../../client/src/index.css', import.meta.url), 'utf8');
const uiStylesheet = readFile(
  new URL('../../../packages/ui/src/styles.css', import.meta.url),
  'utf8',
);
const uiSource = readFile(new URL('../../../packages/ui/src/index.tsx', import.meta.url), 'utf8');

function cssHexToken(css: string, token: string): string {
  const value = css.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1];
  assert.ok(value, `Expected --${token} to be a six-digit hex color`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  assert.ok(channels && channels.length === 3);
  return channels
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function functionSource(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `Expected function ${name}`);
  assert.notEqual(end, -1, `Expected function ${nextName}`);
  return source.slice(start, end);
}

test('TRA-95, TRA-98, and TRA-101 keep setup controls on the shared alignment contract', async () => {
  const [source, css, uiCss] = await Promise.all([appSource, stylesheet, uiStylesheet]);

  for (const label of ['Invitation expires after', 'Timezone', 'Refund approach']) {
    assert.match(source, new RegExp(`<Field(?: hint="[^"]*")? label="${label}">`));
  }
  for (const label of ['Invitation expires after', 'Refund approach']) {
    assert.match(
      source,
      new RegExp(
        `<Field(?: hint="[^"]*")? label="${label}">[\\s\\S]{0,500}?className="trv-input setup-select"`,
      ),
    );
  }
  assert.match(uiCss, /--trv-control-height:\s*44px;/);
  assert.match(uiCss, /button,\s*input,\s*select,\s*textarea\s*\{\s*font:\s*inherit;/);
  assert.match(uiCss, /\.trv-input\s*\{[\s\S]*?min-height:\s*var\(--trv-control-height\);/);
  assert.match(css, /\.setup-form__grid > \.trv-field\s*\{\s*align-content: start;/);
  assert.match(css, /\.setup-form__grid \.trv-input\s*\{\s*width: 100%;/);
  assert.match(
    css,
    /\.setup-select\s*\{[\s\S]*?display: block;[\s\S]*?height: var\(--trv-control-height\);[\s\S]*?width: 100%;/,
  );
});

test('TRA-100 clears a step-scoped setup error before navigating', async () => {
  assert.match(
    await appSource,
    /onNavigate=\{\(step\) => \{\s*setError\(null\);\s*setActiveStep\(step\);\s*\}\}/,
  );
});

test('TRA-104 keeps shared primary actions above the WCAG AA text contrast minimum', async () => {
  const [coachCss, clientCss, uiCss, source] = await Promise.all([
    stylesheet,
    clientStylesheet,
    uiStylesheet,
    uiSource,
  ]);
  const primary = cssHexToken(uiCss, 'trv-action-primary');
  const hover = cssHexToken(uiCss, 'trv-action-primary-hover');

  assert.ok(contrastRatio('#ffffff', primary) >= 4.5);
  assert.ok(contrastRatio('#ffffff', hover) >= 4.5);
  assert.match(
    uiCss,
    /\.trv-button--primary\s*\{[\s\S]*?background:\s*var\(--trv-action-primary\);[\s\S]*?color:\s*white;/,
  );
  assert.match(
    uiCss,
    /\.trv-button--primary:hover:not\(:disabled\)\s*\{\s*background:\s*var\(--trv-action-primary-hover\);/,
  );
  assert.match(uiCss, /\.trv-button:disabled\s*\{[\s\S]*?opacity:\s*0\.6;/);
  assert.match(
    coachCss,
    /\.client-preview__button\s*\{[\s\S]*?background:\s*var\(--trv-action-primary\);/,
  );
  assert.match(
    clientCss,
    /\.onboarding-practice > span\s*\{[\s\S]*?background:\s*var\(--trv-action-primary\);/,
  );
  assert.match(source, new RegExp(`actionPrimary:\\s*'${primary.toUpperCase()}'`));
  assert.match(source, new RegExp(`actionPrimaryHover:\\s*'${hover.toUpperCase()}'`));
});

test('TRA-105 keeps Coach access branding stable through every access transition', async () => {
  const [source, css] = await Promise.all([appSource, stylesheet]);
  const shell = functionSource(source, 'CoachAccessShell', 'LoadError');
  const signOut = functionSource(source, 'CoachSignOut', 'CoachSignIn');
  const signIn = functionSource(source, 'CoachSignIn', 'CoachSignup');
  const signup = functionSource(source, 'CoachSignup', 'CoachEmailVerification');
  const verification = functionSource(
    source,
    'CoachEmailVerification',
    'CoachContractSignaturePage',
  );
  const setup = functionSource(source, 'CoachSetupApp', 'DataPortabilityPage');

  assert.match(
    shell,
    /className=\{`load-state coach-access\$\{wide \? ' coach-access--wide' : ''\}`\}/,
  );
  assert.match(shell, /<span className="trv-wordmark">Traverse<\/span>\s*\{children\}/);
  assert.match(
    css,
    /\.coach-access\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*center;[\s\S]*?position:\s*relative;[\s\S]*?\}[\s\S]*?\.coach-access > \.trv-wordmark\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*24px;[\s\S]*?left:\s*24px;/,
  );
  assert.match(
    css,
    /\.coach-access--wide\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-content:\s*start center;[\s\S]*?padding-top:\s*88px;/,
  );
  assert.doesNotMatch(css, /coach-access--centred/);

  assert.match(signOut, /<CoachAccessShell busy=\{error === null\}>/);
  assert.match(signOut, /<p role="status">Closing your Coach App session\.<\/p>/);
  assert.match(signIn, /<CoachAccessShell>\s*<Card>/);
  assert.equal(signup.match(/<CoachAccessShell/g)?.length, 2);
  assert.match(signup, /if \(submittedEmail !== null\)[\s\S]*?<CoachAccessShell>/);
  assert.match(signup, /<CoachAccessShell wide>/);
  assert.match(verification, /<CoachAccessShell busy=\{status === 'loading' && error === null\}>/);
  assert.match(setup, /setSignInRequired\(false\);\s*await load\(\);/);
  assert.match(
    setup,
    /if \(snapshot === null\)[\s\S]*?<CoachAccessShell busy>[\s\S]*?<p role="status">Opening your practice setup\.\.\.<\/p>/,
  );
});
