import {
  ApiResponseError,
  createClientOnboardingApiClient,
  type InvitePreview,
  type OnboardingSnapshot,
} from '@traverse/api-client';
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  TextInput,
  TileRow,
} from '@traverse/ui';
import { type FormEvent, useEffect, useState } from 'react';

const onboardingApi = createClientOnboardingApiClient();

const navigation = [
  { current: true, href: '#today', label: 'Today' },
  { href: '#reflections', label: 'Reflections' },
  { href: '#sessions', label: 'Sessions' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiResponseError) return error.message;
  return 'We could not save that step. Your completed work is still safe. Please try again.';
}

function ClientDashboard() {
  return (
    <AppShell navigation={navigation} productName="Your coaching space" roleLabel="Client">
      <div className="client-dashboard">
        <PageHeader
          eyebrow="Your coaching space"
          summary="A small place to pause, reflect, and keep moving."
          title="Today"
        />
        <Card tone="editorial">
          <Badge tone="accent">From your coach</Badge>
          <h2>What is one thing you want to carry into this week?</h2>
          <p>Take a moment when it suits you. Your reflection stays between you and your coach.</p>
          <Button type="button">Record a reflection</Button>
        </Card>
        <Card>
          <TileRow
            action={<Button variant="quiet">Watch</Button>}
            description="A short welcome from your coach"
            title="Your welcome video"
          />
        </Card>
        <EmptyState
          action={<Button variant="line">See past sessions</Button>}
          title="Your next session is not booked yet"
        >
          When you are ready, choose a time with your coach.
        </EmptyState>
      </div>
    </AppShell>
  );
}

function Progress({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const steps = [
    snapshot.gates.contractRequired ? 'Agreement' : null,
    snapshot.gates.countersignatureRequired ? 'Coach signature' : null,
    snapshot.gates.intakeRequired ? 'Intake' : null,
  ].filter((step): step is string => step !== null);
  const complete =
    (snapshot.contract?.clientSigned ? 1 : 0) +
    (snapshot.gates.countersignatureRequired && snapshot.contract?.coachSigned ? 1 : 0) +
    (snapshot.intake?.submitted ? 1 : 0);
  return (
    <div className="onboarding-progress">
      <div>
        <span>{Math.min(complete, steps.length)} complete</span>
        <span>{steps.length} steps</span>
      </div>
      <div
        aria-label={`${Math.min(complete, steps.length)} of ${steps.length} onboarding steps complete`}
        aria-valuemax={steps.length}
        aria-valuemin={0}
        aria-valuenow={Math.min(complete, steps.length)}
        className="onboarding-progress__bar"
        role="progressbar"
      >
        <span style={{ width: `${steps.length === 0 ? 100 : (complete / steps.length) * 100}%` }} />
      </div>
    </div>
  );
}

function InvitationWelcome({
  busy,
  onAccept,
  onDecline,
  preview,
}: {
  busy: boolean;
  onAccept(mode: 'magic_link' | 'password', password?: string): void;
  onDecline(): void;
  preview: InvitePreview;
}) {
  const [mode, setMode] = useState<'magic_link' | 'password'>('magic_link');
  const [password, setPassword] = useState('');
  return (
    <main className="onboarding-page">
      <a className="trv-wordmark" href="/" aria-label="Traverse client space">
        Traverse
      </a>
      <Card className="onboarding-welcome" tone="editorial">
        <div className="trv-eyebrow">An invitation from {preview.coachName}</div>
        <h1>Welcome, {preview.clientName}.</h1>
        <p className="onboarding-lede">{preview.welcomeMessage}</p>
        <div className="onboarding-practice">
          <span aria-hidden="true">{preview.coachName.charAt(0)}</span>
          <div>
            <strong>{preview.coachName}</strong>
            <small>{preview.practiceName}</small>
          </div>
        </div>
        <div className="onboarding-choice" role="radiogroup" aria-label="Account security choice">
          <label>
            <input
              checked={mode === 'magic_link'}
              name="account-mode"
              onChange={() => setMode('magic_link')}
              type="radio"
            />
            <span>
              <strong>Continue with this secure link</strong>
              <small>No password needed today.</small>
            </span>
          </label>
          <label>
            <input
              checked={mode === 'password'}
              name="account-mode"
              onChange={() => setMode('password')}
              type="radio"
            />
            <span>
              <strong>Create a password</strong>
              <small>Use it to sign in from any device.</small>
            </span>
          </label>
        </div>
        {mode === 'password' ? (
          <Field hint="At least 10 characters" label="Password">
            <TextInput
              autoComplete="new-password"
              minLength={10}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
        ) : null}
        <div className="onboarding-actions">
          <Button
            disabled={busy || (mode === 'password' && password.length < 10)}
            onClick={() => onAccept(mode, password)}
            type="button"
          >
            {busy ? 'Opening securely...' : 'Begin onboarding'}
          </Button>
          <Button disabled={busy} onClick={onDecline} type="button" variant="quiet">
            Decline invitation
          </Button>
        </div>
        <small className="onboarding-expiry">
          This invitation expires {new Date(preview.expiresAt).toLocaleDateString()}.
        </small>
      </Card>
    </main>
  );
}

function OnboardingSteps({
  busy,
  onSign,
  onSubmitIntake,
  snapshot,
}: {
  busy: boolean;
  onSign(name: string): void;
  onSubmitIntake(answers: Record<string, string>): void;
  snapshot: OnboardingSnapshot;
}) {
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const contractPending = snapshot.gates.contractRequired && !snapshot.contract?.clientSigned;
  const countersignPending =
    snapshot.gates.countersignatureRequired &&
    snapshot.contract?.clientSigned &&
    !snapshot.contract.coachSigned;
  const intakePending =
    snapshot.gates.intakeRequired &&
    !snapshot.intake?.submitted &&
    !contractPending &&
    !countersignPending;

  function submitIntake(event: FormEvent) {
    event.preventDefault();
    onSubmitIntake(answers);
  }

  let content;
  if (snapshot.state === 'active') {
    content = (
      <Card className="onboarding-complete" tone="editorial">
        <div className="onboarding-complete__mark" aria-hidden="true">
          ✓
        </div>
        <div className="trv-eyebrow">Onboarding complete</div>
        <h1>Your coaching space is ready.</h1>
        <p>{snapshot.coach.name} has everything needed to begin your work together.</p>
        <a className="trv-button trv-button--primary" href="/">
          Enter your coaching space
        </a>
      </Card>
    );
  } else if (contractPending && snapshot.contract !== null) {
    content = (
      <Card>
        <div className="trv-eyebrow">Step 1 · coaching agreement</div>
        <h1>Review the agreement.</h1>
        <p className="onboarding-lede">
          Read the full agreement before adding your electronic signature.
        </p>
        <article className="contract-document">
          <h2>{snapshot.contract.name}</h2>
          <pre>{snapshot.contract.body}</pre>
        </article>
        <div className="signature-form">
          <Field label="Your full legal name">
            <TextInput
              autoComplete="name"
              maxLength={160}
              onChange={(event) => setSignerName(event.target.value)}
              required
              value={signerName}
            />
          </Field>
          <label className="signature-consent">
            <input
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              type="checkbox"
            />
            <span>I have read and agree to this coaching agreement.</span>
          </label>
          <Button
            disabled={busy || !agreed || signerName.trim() === ''}
            onClick={() => onSign(signerName)}
            type="button"
          >
            {busy ? 'Signing securely...' : 'Sign agreement'}
          </Button>
        </div>
      </Card>
    );
  } else if (countersignPending) {
    content = (
      <Card className="onboarding-waiting">
        <Badge tone="accent">Your signature is complete</Badge>
        <h1>Waiting for {snapshot.coach.name}.</h1>
        <p>
          Your coach will countersign the agreement. We will let you know as soon as the next step
          is ready.
        </p>
      </Card>
    );
  } else if (intakePending && snapshot.intake !== null) {
    content = (
      <Card>
        <div className="trv-eyebrow">Intake · encrypted</div>
        <h1>A little context for your coach.</h1>
        <p className="onboarding-lede">
          Your answers are encrypted and shared only within this coaching relationship.
        </p>
        <form className="intake-form" onSubmit={submitIntake}>
          {snapshot.intake.fields.map((field) => (
            <Field key={field.id} label={field.label}>
              {field.type === 'short_text' ? (
                <TextInput
                  maxLength={4000}
                  onChange={(event) => setAnswers({ ...answers, [field.id]: event.target.value })}
                  required={field.required}
                  value={answers[field.id] ?? ''}
                />
              ) : (
                <textarea
                  className="trv-input intake-textarea"
                  maxLength={4000}
                  onChange={(event) => setAnswers({ ...answers, [field.id]: event.target.value })}
                  required={field.required}
                  rows={5}
                  value={answers[field.id] ?? ''}
                />
              )}
            </Field>
          ))}
          <Button disabled={busy} type="submit">
            {busy ? 'Saving securely...' : 'Submit intake'}
          </Button>
        </form>
      </Card>
    );
  } else {
    content = (
      <Card>
        <h1>Your next step is being prepared.</h1>
        <p>Please return to this page shortly.</p>
      </Card>
    );
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <a className="trv-wordmark" href="/">
          Traverse
        </a>
        <span>{snapshot.coach.practiceName}</span>
      </header>
      <Progress snapshot={snapshot} />
      <div className="onboarding-step">{content}</div>
    </main>
  );
}

function ClientOnboarding({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    void onboardingApi
      .inspect(token)
      .then(setPreview)
      .catch((caught) => setError(errorMessage(caught)));
  }, [token]);

  async function accept(mode: 'magic_link' | 'password', password?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await onboardingApi.accept(token, { mode, password });
      setSnapshot(result.snapshot);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      await onboardingApi.decline(token);
      setDeclined(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sign(name: string) {
    if (snapshot?.contract === null || snapshot === null) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(
        await onboardingApi.signContract(snapshot.relationshipId, snapshot.contract.id, name),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitIntake(answers: Record<string, string>) {
    if (snapshot === null) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await onboardingApi.submitIntake(snapshot.relationshipId, answers));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (declined) {
    return (
      <main className="onboarding-page onboarding-state">
        <span className="trv-wordmark">Traverse</span>
        <Card>
          <h1>Invitation declined.</h1>
          <p>Your coach can send a new invitation if you change your mind.</p>
        </Card>
      </main>
    );
  }
  if (error !== null) {
    return (
      <main className="onboarding-page onboarding-state">
        <span className="trv-wordmark">Traverse</span>
        <Card>
          <div className="onboarding-error" role="alert">
            {error}
          </div>
          <h1>We could not open this step.</h1>
          <p>The invitation may have expired or already been used. Ask your coach to resend it.</p>
        </Card>
      </main>
    );
  }
  if (snapshot !== null) {
    return (
      <OnboardingSteps
        busy={busy}
        onSign={(name) => void sign(name)}
        onSubmitIntake={(answers) => void submitIntake(answers)}
        snapshot={snapshot}
      />
    );
  }
  if (preview === null) {
    return (
      <main className="onboarding-page onboarding-state" aria-busy="true">
        <span className="trv-wordmark">Traverse</span>
        <p>Opening your secure invitation...</p>
      </main>
    );
  }
  return (
    <InvitationWelcome
      busy={busy}
      onAccept={(mode, password) => void accept(mode, password)}
      onDecline={() => void decline()}
      preview={preview}
    />
  );
}

/** Mobile-first client shell. Coach theming can replace only the accent token later. */
export function App() {
  const token = new URLSearchParams(window.location.search).get('token');
  return window.location.pathname === '/onboarding' && token !== null ? (
    <ClientOnboarding token={token} />
  ) : (
    <ClientDashboard />
  );
}
