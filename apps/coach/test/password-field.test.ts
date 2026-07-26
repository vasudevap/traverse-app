import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PasswordField } from '@traverse/ui';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function renderPasswordField(visible: boolean) {
  return renderToStaticMarkup(
    createElement(PasswordField, {
      hint: 'At least 12 characters',
      id: 'account-password',
      label: 'Password',
      onVisibilityChange() {},
      readOnly: true,
      value: 'example-password',
      visible,
    }),
  );
}

test('password field starts concealed with an accessible Show control', () => {
  const markup = renderPasswordField(false);

  assert.match(markup, /for="account-password"/);
  assert.match(markup, /id="account-password"/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /aria-label="Show password"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /aria-describedby="account-password-hint"/);
});

test('password field exposes the visible state with an accessible Hide control', () => {
  const markup = renderPasswordField(true);

  assert.match(markup, /type="text"/);
  assert.match(markup, /aria-label="Hide password"/);
  assert.match(markup, /aria-pressed="true"/);
});
