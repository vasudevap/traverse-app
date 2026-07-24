import {
  ApiResponseError,
  type ClientLoopHome,
  createClientLoopApiClient,
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
const loopApi = createClientLoopApiClient();

const navigation = [
  { current: true, href: '/', label: 'Today' },
  { href: '#tasks', label: 'Tasks' },
  { href: '#sessions', label: 'Sessions' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiResponseError) return error.message;
  return 'We could not save that step. Your completed work is still safe. Please try again.';
}

function ClientDashboard() {
  const [home, setHome] = useState<ClientLoopHome | null>(null);
  const [pendingOnboarding, setPendingOnboarding] = useState<OnboardingSnapshot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const pending = await onboardingApi.pending();
      setPendingOnboarding(pending);
      if (pending.length > 0) {
        setHome(null);
        return;
      }
      setHome(await loopApi.current());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pendingSnapshot = pendingOnboarding?.[0];
  if (pendingSnapshot !== undefined) {
    return <AuthenticatedOnboarding initialSnapshot={pendingSnapshot} />;
  }

  async function completeTask(taskId: string) {
    setBusy(taskId);
    setError(null);
    try {
      await loopApi.completeTask(taskId);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function book(relationshipId: string, availabilityId: string, appointmentTypeId: string) {
    setBusy(availabilityId);
    setError(null);
    let holdId: string | null = null;
    try {
      const hold = await loopApi.createHold({ availabilityId, relationshipId });
      holdId = hold.id;
      await loopApi.confirmBooking(hold.id, { appointmentTypeId, relationshipId });
      await load();
    } catch (caught) {
      if (holdId !== null) {
        try {
          await loopApi.releaseHold(holdId);
        } catch {
          // The hold may already be converted or expired.
        }
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (home === null) {
    return (
      <main className="onboarding-page onboarding-state" aria-busy="true">
        <span className="trv-wordmark">Traverse</span>
        <p>{error ?? 'Opening your coaching space...'}</p>
        {error ? (
          <Button onClick={() => void load()} type="button">
            Try again
          </Button>
        ) : null}
      </main>
    );
  }

  const upcoming = home.appointments.filter(
    (appointment) =>
      appointment.status !== 'canceled' && new Date(appointment.endsAt).getTime() >= Date.now(),
  );
  const openTasks = home.tasks.filter((task) => task.status === 'assigned');
  const nextTaskId = home.nextAction.kind === 'task' ? home.nextAction.taskId : null;
  const nextAppointmentId =
    home.nextAction.kind === 'appointment' ? home.nextAction.appointmentId : null;
  const nextAppointment =
    nextAppointmentId !== null
      ? home.appointments.find((appointment) => appointment.id === nextAppointmentId)
      : undefined;

  return (
    <AppShell navigation={navigation} productName="Your coaching space" roleLabel="Client">
      <div className="client-dashboard">
        <PageHeader
          eyebrow="Your coaching space"
          summary="Your sessions and commitments, organized around each coaching relationship."
          title="Today"
        />
        {error ? (
          <div className="onboarding-error" role="alert">
            {error}
          </div>
        ) : null}
        <Card className="client-next-action" tone="editorial">
          <Badge tone="accent">Next step</Badge>
          {home.nextAction.kind === 'waiting' ? (
            <>
              <h2>Your coach is preparing what comes next.</h2>
              <p>{home.nextAction.message}</p>
            </>
          ) : home.nextAction.kind === 'task' ? (
            <>
              <h2>{home.nextAction.title}</h2>
              <p>Complete this coaching task when you are ready.</p>
              <Button
                disabled={busy === nextTaskId}
                onClick={() => {
                  if (nextTaskId !== null) void completeTask(nextTaskId);
                }}
                type="button"
              >
                {busy === nextTaskId ? 'Completing...' : 'Mark complete'}
              </Button>
            </>
          ) : (
            <>
              <h2>{home.nextAction.title}</h2>
              <p>
                {new Date(home.nextAction.startsAt).toLocaleString([], {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </p>
              {nextAppointment?.meetingLink ? (
                <a
                  className="trv-button trv-button--primary"
                  href={nextAppointment.meetingLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  Join session
                </a>
              ) : null}
            </>
          )}
        </Card>

        <section className="client-loop-section" id="sessions">
          <div className="client-loop-section__heading">
            <div>
              <div className="trv-eyebrow">Sessions</div>
              <h2>Upcoming appointments</h2>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState title="No session is booked yet">
              Choose one of your coach's proposed times below when it suits you.
            </EmptyState>
          ) : (
            <Card>
              {upcoming.map((appointment) => (
                <TileRow
                  action={
                    <div className="client-row-actions">
                      {appointment.meetingLink ? (
                        <a
                          className="trv-button trv-button--primary"
                          href={appointment.meetingLink}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Join
                        </a>
                      ) : null}
                      <a className="trv-button trv-button--line" href={appointment.calendarUrl}>
                        Add to calendar
                      </a>
                    </div>
                  }
                  description={`${new Date(appointment.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${appointment.target.name}`}
                  key={appointment.id}
                  title={appointment.title}
                />
              ))}
            </Card>
          )}
        </section>

        {home.relationships.map((relationship) => {
          const appointmentType = relationship.appointmentTypes[0];
          return (
            <section className="client-loop-section" key={relationship.id}>
              <div className="client-loop-section__heading">
                <div>
                  <div className="trv-eyebrow">{relationship.coach.practiceName}</div>
                  <h2>Book with {relationship.coach.name}</h2>
                </div>
              </div>
              {relationship.availableSlots.length === 0 || appointmentType === undefined ? (
                <Card>
                  <p className="client-muted">No proposed times are available right now.</p>
                </Card>
              ) : (
                <Card>
                  {relationship.availableSlots.map((slot) => (
                    <TileRow
                      action={
                        <Button
                          disabled={busy === slot.id}
                          onClick={() => void book(relationship.id, slot.id, appointmentType.id)}
                          type="button"
                          variant="line"
                        >
                          {busy === slot.id ? 'Holding...' : 'Book this time'}
                        </Button>
                      }
                      description={
                        slot.endsAt === null
                          ? relationship.coach.name
                          : `Until ${new Date(slot.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                      }
                      key={slot.id}
                      title={
                        slot.startsAt === null
                          ? 'Proposed time'
                          : new Date(slot.startsAt).toLocaleString([], {
                              dateStyle: 'full',
                              timeStyle: 'short',
                            })
                      }
                    />
                  ))}
                </Card>
              )}
            </section>
          );
        })}

        <section className="client-loop-section" id="tasks">
          <div className="client-loop-section__heading">
            <div>
              <div className="trv-eyebrow">Accountability</div>
              <h2>Your tasks</h2>
            </div>
            <Badge tone={openTasks.length > 0 ? 'mark' : 'neutral'}>{openTasks.length} open</Badge>
          </div>
          {home.tasks.length === 0 ? (
            <Card>
              <p className="client-muted">Nothing is assigned right now.</p>
            </Card>
          ) : (
            <Card>
              {home.tasks.map((task) => (
                <TileRow
                  action={
                    task.status === 'assigned' ? (
                      <Button
                        disabled={busy === task.id}
                        onClick={() => void completeTask(task.id)}
                        type="button"
                        variant="line"
                      >
                        {busy === task.id ? 'Completing...' : 'Mark complete'}
                      </Button>
                    ) : (
                      <Badge tone={task.status === 'completed' ? 'accent' : 'neutral'}>
                        {task.status === 'completed' ? 'Complete' : 'Canceled'}
                      </Badge>
                    )
                  }
                  description={
                    task.description ??
                    (task.dueAt
                      ? `Due ${new Date(task.dueAt).toLocaleDateString()}`
                      : task.clientName)
                  }
                  key={task.id}
                  title={task.title}
                />
              ))}
            </Card>
          )}
        </section>
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
  error,
  onSign,
  onSubmitIntake,
  snapshot,
}: {
  busy: boolean;
  error: string | null;
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
        <h1>We could not open your next onboarding step.</h1>
        <p>Please contact your coach so they can confirm your onboarding requirements.</p>
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
      <div className="onboarding-step">
        {error ? (
          <div className="onboarding-error" role="alert">
            {error}
          </div>
        ) : null}
        {content}
      </div>
    </main>
  );
}

function AuthenticatedOnboarding({ initialSnapshot }: { initialSnapshot: OnboardingSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sign(name: string) {
    if (snapshot.contract === null) return;
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

  return (
    <OnboardingSteps
      busy={busy}
      error={error}
      onSign={(name) => void sign(name)}
      onSubmitIntake={(answers) => void submitIntake(answers)}
      snapshot={snapshot}
    />
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
    return <AuthenticatedOnboarding initialSnapshot={snapshot} />;
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
