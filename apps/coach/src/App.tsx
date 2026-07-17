import {
  ApiResponseError,
  type CoachContractSnapshot,
  type CoachSetupSnapshot,
  createCoachContractApiClient,
  createCoachInviteApiClient,
  createCoachSetupApiClient,
  type InviteOptions,
  type SetupStep,
} from '@traverse/api-client';
import { AppShell, Badge, Button, Card, Field, PageHeader, TextInput } from '@traverse/ui';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

const setupApi = createCoachSetupApiClient();
const inviteApi = createCoachInviteApiClient();
const contractApi = createCoachContractApiClient();
const navigation = [
  { current: true, href: '#dashboard', label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/library', label: 'Library' },
];

type SetupAction = () => Promise<CoachSetupSnapshot>;

function errorMessage(error: unknown): string {
  if (error instanceof ApiResponseError) return error.message;
  return 'Something went wrong. Your saved work is still safe. Please try again.';
}

function daysRemaining(trialEndsAt: string): number {
  const difference = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(difference / (24 * 60 * 60 * 1000)));
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'C'
  );
}

function SetupFrame({
  activeStep,
  busy,
  children,
  error,
  onNavigate,
  snapshot,
}: {
  activeStep: SetupStep;
  busy: boolean;
  children: ReactNode;
  error: string | null;
  onNavigate(step: SetupStep): void;
  snapshot: CoachSetupSnapshot;
}) {
  const completed = snapshot.checklist.filter((item) => item.status !== 'pending').length;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [activeStep]);

  return (
    <div className="setup-shell">
      <header className="setup-topbar">
        <a className="trv-wordmark" href="#setup" aria-label="Traverse coach setup">
          Traverse
        </a>
        <div className="setup-topbar__meta">
          <Badge tone="accent">{snapshot.plan.name} trial</Badge>
          <span>{daysRemaining(snapshot.plan.trialEndsAt)} days left</span>
        </div>
      </header>
      <div className="setup-layout">
        <aside className="setup-progress" aria-label="Practice setup progress">
          <div>
            <div className="trv-eyebrow">Practice setup</div>
            <h2>Build the welcome clients will feel.</h2>
            <p>
              {completed} of {snapshot.checklist.length} setup choices saved
            </p>
          </div>
          <div
            aria-label={`${completed} of ${snapshot.checklist.length} setup choices saved`}
            aria-valuemax={snapshot.checklist.length}
            aria-valuemin={0}
            aria-valuenow={completed}
            className="setup-meter"
            role="progressbar"
          >
            <span style={{ width: `${(completed / snapshot.checklist.length) * 100}%` }} />
          </div>
          <ol className="setup-checklist">
            {snapshot.checklist.map((item, index) => (
              <li key={item.label}>
                <button
                  aria-current={activeStep === item.step ? 'step' : undefined}
                  className={`setup-checklist__item setup-checklist__item--${item.status}`}
                  disabled={busy}
                  onClick={() => onNavigate(item.step)}
                  type="button"
                >
                  <span className="setup-checklist__number" aria-hidden="true">
                    {item.status === 'complete' ? '✓' : item.status === 'skipped' ? '·' : index + 1}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.required
                        ? 'Required'
                        : item.status === 'skipped'
                          ? 'Using defaults'
                          : 'Optional'}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="setup-progress__reassurance">Every step saves. Come back any time.</p>
        </aside>
        <main className="setup-main" aria-busy={busy}>
          <h1 className="sr-only" ref={heading} tabIndex={-1}>
            Coach practice setup
          </h1>
          {error ? (
            <div className="setup-alert" role="alert">
              {error}
            </div>
          ) : null}
          {children}
          <div aria-live="polite" className="sr-only" role="status">
            {busy ? 'Saving your setup.' : ''}
          </div>
        </main>
      </div>
    </div>
  );
}

function FormActions({
  busy,
  primaryLabel = 'Save and continue',
  secondary,
}: {
  busy: boolean;
  primaryLabel?: string;
  secondary?: ReactNode;
}) {
  return (
    <div className="setup-actions">
      <Button disabled={busy} type="submit">
        {busy ? 'Saving...' : primaryLabel}
      </Button>
      {secondary}
      <span className="setup-saved-note">Saved securely to your practice</span>
    </div>
  );
}

function PracticeProfileForm({
  busy,
  onSave,
  snapshot,
}: {
  busy: boolean;
  onSave(input: CoachSetupSnapshot['practice']): void;
  snapshot: CoachSetupSnapshot;
}) {
  const [profile, setProfile] = useState(snapshot.practice);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(profile);
  }
  return (
    <section className="setup-panel" aria-labelledby="practice-heading">
      <div className="trv-eyebrow">Practice profile · required</div>
      <h2 id="practice-heading">How your practice shows up.</h2>
      <p className="setup-lede">
        Clients see your practice name. The remaining details keep agreements and future invoices
        consistent.
      </p>
      <form className="setup-form" onSubmit={submit}>
        <Field label="Practice display name">
          <TextInput
            autoComplete="organization"
            maxLength={120}
            onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
            required
            value={profile.displayName}
          />
        </Field>
        <div className="setup-form__grid">
          <Field hint="Optional" label="Business or legal name">
            <TextInput
              maxLength={200}
              onChange={(event) => setProfile({ ...profile, legalName: event.target.value })}
              value={profile.legalName}
            />
          </Field>
          <Field label="Timezone">
            <TextInput
              list="timezone-options"
              maxLength={100}
              onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
              required
              value={profile.timezone}
            />
            <datalist id="timezone-options">
              <option value="America/Toronto" />
              <option value="America/New_York" />
              <option value="America/Chicago" />
              <option value="America/Denver" />
              <option value="America/Los_Angeles" />
              <option value="Europe/London" />
              <option value="Australia/Sydney" />
            </datalist>
          </Field>
          <Field hint="Optional" label="Business email">
            <TextInput
              autoComplete="email"
              maxLength={254}
              onChange={(event) => setProfile({ ...profile, businessEmail: event.target.value })}
              type="email"
              value={profile.businessEmail}
            />
          </Field>
          <Field hint="Optional" label="Phone">
            <TextInput
              autoComplete="tel"
              maxLength={40}
              onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
              type="tel"
              value={profile.phone}
            />
          </Field>
          <Field hint="Optional" label="Website">
            <TextInput
              autoComplete="url"
              maxLength={300}
              onChange={(event) => setProfile({ ...profile, websiteUrl: event.target.value })}
              placeholder="yourpractice.com"
              value={profile.websiteUrl}
            />
          </Field>
          <Field hint="Optional" label="Business address">
            <TextInput
              autoComplete="street-address"
              maxLength={500}
              onChange={(event) => setProfile({ ...profile, businessAddress: event.target.value })}
              value={profile.businessAddress}
            />
          </Field>
        </div>
        <FormActions busy={busy} />
      </form>
    </section>
  );
}

function CoachProfileForm({
  busy,
  onSave,
  onUpload,
  snapshot,
}: {
  busy: boolean;
  onSave(input: Omit<CoachSetupSnapshot['coach'], 'profilePhotoRef' | 'profilePhotoUrl'>): void;
  onUpload(file: File): void;
  snapshot: CoachSetupSnapshot;
}) {
  const [profile, setProfile] = useState({
    bio: snapshot.coach.bio,
    discipline: snapshot.coach.discipline,
    displayName: snapshot.coach.displayName,
    specialties: snapshot.coach.specialties,
  });
  const specialties = profile.specialties.join(', ');
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(profile);
  }
  return (
    <section className="setup-panel" aria-labelledby="coach-heading">
      <div className="trv-eyebrow">Your coach profile · required</div>
      <h2 id="coach-heading">The face your clients meet first.</h2>
      <p className="setup-lede">
        Your name and discipline are required. A photo and a short bio make the welcome feel
        personal.
      </p>
      <form className="setup-form" onSubmit={submit}>
        <div className="profile-photo-row">
          <div className="profile-photo" aria-hidden="true">
            {snapshot.coach.profilePhotoUrl ? (
              <img alt="" src={snapshot.coach.profilePhotoUrl} />
            ) : (
              initials(profile.displayName)
            )}
          </div>
          <div>
            <label className="trv-button trv-button--line upload-label">
              {snapshot.coach.profilePhotoUrl ? 'Replace photo' : 'Upload a photo'}
              <input
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file !== undefined) onUpload(file);
                  event.currentTarget.value = '';
                }}
                type="file"
              />
            </label>
            <p className="field-note">JPEG, PNG, or WebP. 5 MB maximum.</p>
          </div>
        </div>
        <div className="setup-form__grid">
          <Field label="Display name">
            <TextInput
              autoComplete="name"
              maxLength={120}
              onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
              required
              value={profile.displayName}
            />
          </Field>
          <Field label="Primary coaching discipline">
            <TextInput
              maxLength={120}
              onChange={(event) => setProfile({ ...profile, discipline: event.target.value })}
              required
              value={profile.discipline}
            />
          </Field>
        </div>
        <Field hint="Optional, comma-separated" label="Specialties">
          <TextInput
            maxLength={600}
            onChange={(event) =>
              setProfile({
                ...profile,
                specialties: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
            placeholder="Leadership, career transitions, team development"
            value={specialties}
          />
        </Field>
        <Field hint={`${profile.bio.length}/600 · Optional`} label="Short bio">
          <textarea
            className="trv-input setup-textarea"
            maxLength={600}
            onChange={(event) => setProfile({ ...profile, bio: event.target.value })}
            rows={5}
            value={profile.bio}
          />
        </Field>
        <FormActions busy={busy} />
      </form>
    </section>
  );
}

function OptionalStep({
  body,
  busy,
  eyebrow,
  highlights,
  onContinue,
  title,
}: {
  body: string;
  busy: boolean;
  eyebrow: string;
  highlights: string[];
  onContinue(): void;
  title: string;
}) {
  return (
    <section className="setup-panel" aria-labelledby="optional-heading">
      <div className="trv-eyebrow">{eyebrow} · optional</div>
      <h2 id="optional-heading">{title}</h2>
      <p className="setup-lede">{body}</p>
      <Card tone="editorial" className="optional-card">
        <Badge tone="mark">Safe to skip</Badge>
        <ul>
          {highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </Card>
      <div className="setup-actions">
        <Button disabled={busy} onClick={onContinue} type="button">
          {busy ? 'Saving...' : 'Use defaults and continue'}
        </Button>
        <span className="setup-saved-note">You can change this later in Settings</span>
      </div>
    </section>
  );
}

function ToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled?: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className={`toggle-row${disabled ? ' toggle-row--disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function DefaultsForm({
  busy,
  onDefaults,
  onSave,
  snapshot,
}: {
  busy: boolean;
  onDefaults(): void;
  onSave(input: CoachSetupSnapshot['onboardingDefaults']): void;
  snapshot: CoachSetupSnapshot;
}) {
  const [defaults, setDefaults] = useState(snapshot.onboardingDefaults);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(defaults);
  }
  return (
    <section className="setup-panel" aria-labelledby="defaults-heading">
      <div className="trv-eyebrow">Onboarding defaults · optional</div>
      <h2 id="defaults-heading">What every new client does first.</h2>
      <p className="setup-lede">Set this once, then adjust it for any individual invitation.</p>
      <form className="setup-form" onSubmit={submit}>
        <fieldset className="toggle-list">
          <legend className="sr-only">Default onboarding gates</legend>
          <ToggleRow
            checked={defaults.contractRequired}
            description="Client reviews and signs your selected agreement"
            label="Sign a contract"
            onChange={(contractRequired) =>
              setDefaults({
                ...defaults,
                contractRequired,
                countersignatureRequired: contractRequired
                  ? defaults.countersignatureRequired
                  : false,
              })
            }
          />
          <ToggleRow
            checked={defaults.countersignatureRequired}
            description="You sign after the client"
            disabled={!defaults.contractRequired}
            label="Coach countersignature"
            onChange={(countersignatureRequired) =>
              setDefaults({ ...defaults, countersignatureRequired })
            }
          />
          <ToggleRow
            checked={defaults.intakeRequired}
            description="Client completes your intake questions"
            label="Complete an intake"
            onChange={(intakeRequired) => setDefaults({ ...defaults, intakeRequired })}
          />
          <ToggleRow
            checked={false}
            description="Available after your Stripe account is connected"
            disabled
            label="Pay before the first session"
            onChange={() => undefined}
          />
        </fieldset>
        <div className="setup-form__grid">
          <Field hint="1 to 30 days" label="Invite expires after">
            <div className="input-suffix">
              <TextInput
                max={30}
                min={1}
                onChange={(event) =>
                  setDefaults({ ...defaults, inviteExpiryDays: Number(event.target.value) })
                }
                required
                type="number"
                value={defaults.inviteExpiryDays}
              />
              <span>days</span>
            </div>
          </Field>
          <Field hint="Comma-separated days after sending" label="Reminder cadence">
            <TextInput
              onChange={(event) =>
                setDefaults({
                  ...defaults,
                  reminderCadenceDays: event.target.value
                    .split(',')
                    .map((value) => Number(value.trim()))
                    .filter((value) => Number.isInteger(value) && value > 0),
                })
              }
              value={defaults.reminderCadenceDays.join(', ')}
            />
          </Field>
        </div>
        <FormActions
          busy={busy}
          secondary={
            <Button disabled={busy} onClick={onDefaults} type="button" variant="line">
              Use Traverse defaults
            </Button>
          }
        />
      </form>
    </section>
  );
}

function PoliciesForm({
  busy,
  onDefaults,
  onSave,
  snapshot,
}: {
  busy: boolean;
  onDefaults(): void;
  onSave(input: CoachSetupSnapshot['policies']): void;
  snapshot: CoachSetupSnapshot;
}) {
  const [policies, setPolicies] = useState(snapshot.policies);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(policies);
  }
  return (
    <section className="setup-panel" aria-labelledby="policies-heading">
      <div className="trv-eyebrow">Policies and agreement · optional</div>
      <h2 id="policies-heading">A clear start, without the blank page.</h2>
      <p className="setup-lede">
        Start with a calm cancellation policy and a coaching agreement you can review later.
      </p>
      <form className="setup-form" onSubmit={submit}>
        <div className="setup-form__grid">
          <Field hint="0 to 168 hours" label="Cancellation notice">
            <div className="input-suffix">
              <TextInput
                max={168}
                min={0}
                onChange={(event) =>
                  setPolicies({
                    ...policies,
                    cancellationNoticeHours: Number(event.target.value),
                  })
                }
                required
                type="number"
                value={policies.cancellationNoticeHours}
              />
              <span>hours</span>
            </div>
          </Field>
          <Field label="Refund approach">
            <select
              className="trv-input setup-select"
              onChange={(event) =>
                setPolicies({
                  ...policies,
                  refundPolicy: event.target
                    .value as CoachSetupSnapshot['policies']['refundPolicy'],
                })
              }
              value={policies.refundPolicy}
            >
              <option value="flexible">Flexible</option>
              <option value="standard">Standard</option>
              <option value="strict">Strict</option>
            </select>
          </Field>
        </div>
        <Field hint={`${policies.cancellationSummary.length}/600`} label="Cancellation summary">
          <textarea
            className="trv-input setup-textarea"
            maxLength={600}
            onChange={(event) =>
              setPolicies({ ...policies, cancellationSummary: event.target.value })
            }
            rows={3}
            value={policies.cancellationSummary}
          />
        </Field>
        <Field hint={`${policies.welcomeMessage.length}/300`} label="Client welcome message">
          <textarea
            className="trv-input setup-textarea"
            maxLength={300}
            onChange={(event) => setPolicies({ ...policies, welcomeMessage: event.target.value })}
            rows={3}
            value={policies.welcomeMessage}
          />
        </Field>
        <label className="agreement-choice">
          <input
            checked={policies.starterTemplateSelected}
            onChange={(event) =>
              setPolicies({ ...policies, starterTemplateSelected: event.target.checked })
            }
            type="checkbox"
          />
          <span>
            <strong>Use the Traverse starter coaching agreement</strong>
            <small>
              Includes coaching scope, responsibilities, confidentiality boundaries, and your
              cancellation summary.
            </small>
          </span>
        </label>
        <p className="legal-note">
          Starter templates are not legal advice. You are responsible for confirming they fit your
          services and jurisdiction.
        </p>
        <FormActions
          busy={busy}
          secondary={
            <Button disabled={busy} onClick={onDefaults} type="button" variant="line">
              Use starter defaults
            </Button>
          }
        />
      </form>
    </section>
  );
}

function ClientPreview({
  busy,
  onBack,
  onContinue,
  snapshot,
}: {
  busy: boolean;
  onBack(): void;
  onContinue(): void;
  snapshot: CoachSetupSnapshot;
}) {
  const gates = [
    snapshot.onboardingDefaults.contractRequired ? 'Review and sign your agreement' : null,
    snapshot.onboardingDefaults.intakeRequired ? 'Complete a short intake' : null,
    snapshot.onboardingDefaults.paymentRequired ? 'Pay for your first session' : null,
  ].filter((gate): gate is string => gate !== null);
  return (
    <section className="setup-panel setup-panel--preview" aria-labelledby="preview-heading">
      <div className="trv-eyebrow">Client preview</div>
      <h2 id="preview-heading">Your first impression.</h2>
      <p className="setup-lede">This is the welcome a new client will receive from you.</p>
      <div className="client-preview">
        <div className="client-preview__brand">
          <span>{initials(snapshot.practice.displayName)}</span>
          {snapshot.practice.displayName}
        </div>
        <div className="client-preview__body">
          <div className="client-preview__coach">
            <div className="client-preview__avatar" aria-hidden="true">
              {snapshot.coach.profilePhotoUrl ? (
                <img alt="" src={snapshot.coach.profilePhotoUrl} />
              ) : (
                initials(snapshot.coach.displayName)
              )}
            </div>
            <span>{snapshot.coach.displayName}</span>
          </div>
          <h3>Welcome, Maya.</h3>
          <p>{snapshot.policies.welcomeMessage}</p>
          {gates.length > 0 ? (
            <ol>
              {gates.map((gate) => (
                <li key={gate}>{gate}</li>
              ))}
            </ol>
          ) : (
            <p>You can move straight into your coaching space.</p>
          )}
          <span className="client-preview__button">Get started</span>
          <small>Powered by Traverse · Your data is always yours</small>
        </div>
      </div>
      <div className="setup-actions setup-actions--center">
        <Button disabled={busy} onClick={onContinue} type="button">
          {busy ? 'Saving...' : 'Looks good - go to dashboard'}
        </Button>
        <Button disabled={busy} onClick={onBack} type="button" variant="line">
          Back to edit
        </Button>
      </div>
    </section>
  );
}

function CoachDashboard({
  onReview,
  snapshot,
}: {
  onReview(): void;
  snapshot: CoachSetupSnapshot;
}) {
  const finished = snapshot.checklist.filter((item) => item.status !== 'pending').length;
  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        actions={
          <a className="trv-button trv-button--primary" href="/clients/new">
            Invite your first client
          </a>
        }
        eyebrow="Coach workspace"
        summary="Your practice is ready. One invitation is all it takes to begin."
        title={`Welcome, ${snapshot.coach.displayName.split(' ')[0] || 'Coach'}`}
      />
      <div className="coach-dashboard">
        <Card className="dashboard-ready-card">
          <div className="dashboard-ready-card__mark" aria-hidden="true">
            ✓
          </div>
          <div>
            <div className="trv-eyebrow">Ready for your first client</div>
            <h2>{snapshot.practice.displayName} is set up.</h2>
            <p>
              Your welcome, onboarding defaults, and starter policies are ready. Invite a client
              now, or return when the timing feels right.
            </p>
            <a className="trv-button trv-button--primary" href="/clients/new">
              Invite your first client
            </a>
          </div>
        </Card>
        <Card tone="editorial">
          <div className="trv-eyebrow">Setup checklist</div>
          <h2>
            {finished} of {snapshot.checklist.length} choices saved
          </h2>
          <ul className="dashboard-checklist">
            {snapshot.checklist.map((item) => (
              <li key={item.label}>
                <span aria-hidden="true">{item.status === 'complete' ? '✓' : '·'}</span>
                {item.label}
                {item.status === 'skipped' ? <small>Using defaults</small> : null}
              </li>
            ))}
          </ul>
          <button className="dashboard-edit-link" onClick={onReview} type="button">
            Review setup
          </button>
        </Card>
      </div>
    </AppShell>
  );
}

function LoadError({ error, onRetry }: { error: string; onRetry(): void }) {
  return (
    <main className="load-state">
      <span className="trv-wordmark">Traverse</span>
      <Card>
        <div className="trv-eyebrow">Coach setup</div>
        <h1>We could not open your practice setup.</h1>
        <p>{error}</p>
        <Button onClick={onRetry} type="button">
          Try again
        </Button>
      </Card>
    </main>
  );
}

function CoachContractSignaturePage({ contractId }: { contractId: string }) {
  const [contract, setContract] = useState<CoachContractSnapshot | null>(null);
  const [signerName, setSignerName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedState, setCompletedState] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setContract(await contractApi.get(contractId));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [contractId]);

  async function sign() {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await contractApi.sign(contractId, signerName);
      setCompletedState(snapshot.state);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (contract === null) {
    return (
      <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
        <div className="invite-layout invite-layout--confirmation">
          <Card className="invite-confirmation">
            <div className="trv-eyebrow">Agreement countersignature</div>
            {error ? (
              <>
                <h1>We could not open this agreement.</h1>
                <p>{error}</p>
                <Button onClick={() => void load()} type="button">
                  Try again
                </Button>
              </>
            ) : (
              <p aria-busy="true">Opening the signed agreement...</p>
            )}
          </Card>
        </div>
      </AppShell>
    );
  }

  if (completedState !== null || contract.coachSigned) {
    return (
      <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
        <div className="invite-layout invite-layout--confirmation">
          <Card className="invite-confirmation">
            <div className="dashboard-ready-card__mark" aria-hidden="true">
              ✓
            </div>
            <div className="trv-eyebrow">Agreement countersigned</div>
            <h1>{contract.clientName} can continue.</h1>
            <p>
              Both signatures are recorded with the immutable agreement snapshot. The next client
              step is {completedState === 'active' ? 'their coaching space' : 'their intake'}.
            </p>
            <a className="trv-button trv-button--primary" href="/">
              Return to dashboard
            </a>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        eyebrow="Agreement countersignature"
        summary={`${contract.clientName} has signed. Review the preserved agreement before adding your signature.`}
        title={`Countersign for ${contract.clientName}`}
      />
      <div className="invite-layout">
        {error ? (
          <div className="setup-alert" role="alert">
            {error}
          </div>
        ) : null}
        <Card className="coach-contract-card">
          <Badge tone={contract.clientSigned ? 'accent' : 'neutral'}>
            {contract.clientSigned ? 'Client signature recorded' : 'Waiting for client signature'}
          </Badge>
          <article className="coach-contract-document">
            <h2>{contract.name}</h2>
            <pre>{contract.body}</pre>
          </article>
          <div className="coach-contract-signature">
            <Field label="Your full legal name">
              <TextInput
                autoComplete="name"
                maxLength={160}
                onChange={(event) => setSignerName(event.target.value)}
                required
                value={signerName}
              />
            </Field>
            <label className="coach-contract-consent">
              <input
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                type="checkbox"
              />
              <span>I have read and agree to this coaching agreement.</span>
            </label>
            <Button
              disabled={busy || !contract.clientSigned || !agreed || signerName.trim() === ''}
              onClick={() => void sign()}
              type="button"
            >
              {busy ? 'Signing securely...' : 'Countersign agreement'}
            </Button>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function InviteClientPage() {
  const [options, setOptions] = useState<InviteOptions | null>(null);
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contractTemplateId, setContractTemplateId] = useState<string | null>(null);
  const [intakeFormId, setIntakeFormId] = useState<string | null>(null);
  const [contractRequired, setContractRequired] = useState(true);
  const [countersignatureRequired, setCountersignatureRequired] = useState(false);
  const [intakeRequired, setIntakeRequired] = useState(true);
  const [expiryDays, setExpiryDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; expiresAt: string } | null>(null);

  useEffect(() => {
    void inviteApi
      .options()
      .then((loaded) => {
        setOptions(loaded);
        setContractRequired(loaded.defaults.contractRequired);
        setCountersignatureRequired(loaded.defaults.countersignatureRequired);
        setIntakeRequired(loaded.defaults.intakeRequired);
        setExpiryDays(loaded.defaults.inviteExpiryDays);
        setContractTemplateId(loaded.templates[0]?.id ?? null);
        setIntakeFormId(loaded.forms[0]?.id ?? null);
      })
      .catch((caught) => setError(errorMessage(caught)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const invitation = await inviteApi.create({
        clientName,
        contractTemplateId: contractRequired ? contractTemplateId : null,
        email,
        gates: {
          contractRequired,
          countersignatureRequired: contractRequired && countersignatureRequired,
          intakeRequired,
          paymentRequired: false,
        },
        intakeFormId: intakeRequired ? intakeFormId : null,
        inviteExpiryDays: expiryDays,
        phone,
      });
      setSent({ email: invitation.email, expiresAt: invitation.expiresAt });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
        <div className="invite-layout invite-layout--confirmation">
          <Card className="invite-confirmation">
            <div className="dashboard-ready-card__mark" aria-hidden="true">
              ✓
            </div>
            <div className="trv-eyebrow">Invitation sent</div>
            <h1>Your client has a clear next step.</h1>
            <p>
              We sent a secure invitation to <strong>{sent.email}</strong>. It expires on{' '}
              {new Date(sent.expiresAt).toLocaleDateString()}.
            </p>
            <div className="setup-actions">
              <a className="trv-button trv-button--primary" href="#dashboard">
                Return to dashboard
              </a>
              <Button onClick={() => setSent(null)} type="button" variant="line">
                Invite another client
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        eyebrow="Client onboarding"
        summary="Choose what this client needs, then Traverse guides them through each step."
        title="Invite a client"
      />
      <div className="invite-layout">
        {error ? (
          <div className="setup-alert" role="alert">
            {error}
          </div>
        ) : null}
        <form className="invite-form" onSubmit={(event) => void submit(event)}>
          <Card>
            <div className="trv-eyebrow">Client details</div>
            <h2>Who are you welcoming?</h2>
            <div className="setup-form__grid">
              <Field label="Client name">
                <TextInput
                  autoComplete="name"
                  maxLength={160}
                  onChange={(event) => setClientName(event.target.value)}
                  required
                  value={clientName}
                />
              </Field>
              <Field label="Email">
                <TextInput
                  autoComplete="email"
                  maxLength={254}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </Field>
              <Field hint="Optional" label="Phone">
                <TextInput
                  autoComplete="tel"
                  maxLength={40}
                  onChange={(event) => setPhone(event.target.value)}
                  type="tel"
                  value={phone}
                />
              </Field>
              <Field label="Invitation expires after">
                <select
                  className="trv-input setup-select"
                  onChange={(event) => setExpiryDays(Number(event.target.value))}
                  value={expiryDays}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={21}>21 days</option>
                  <option value={30}>30 days</option>
                </select>
              </Field>
            </div>
          </Card>
          <Card>
            <div className="trv-eyebrow">Onboarding path</div>
            <h2>What should happen before coaching begins?</h2>
            <div className="invite-gates">
              <label className="invite-gate-choice">
                <input
                  checked={contractRequired}
                  onChange={(event) => setContractRequired(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Sign a coaching agreement</strong>
                  <small>Creates an immutable copy for this relationship.</small>
                </span>
              </label>
              {contractRequired ? (
                <Field label="Agreement">
                  <select
                    className="trv-input setup-select"
                    onChange={(event) => setContractTemplateId(event.target.value || null)}
                    required
                    value={contractTemplateId ?? ''}
                  >
                    <option disabled value="">
                      Select an agreement
                    </option>
                    {options?.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <label className="invite-gate-choice">
                <input
                  checked={countersignatureRequired}
                  disabled={!contractRequired}
                  onChange={(event) => setCountersignatureRequired(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Require my countersignature</strong>
                  <small>The client continues after both signatures are recorded.</small>
                </span>
              </label>
              <label className="invite-gate-choice">
                <input
                  checked={intakeRequired}
                  onChange={(event) => setIntakeRequired(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>Complete an intake</strong>
                  <small>Answers are encrypted before they are stored.</small>
                </span>
              </label>
              {intakeRequired ? (
                <Field label="Intake form">
                  <select
                    className="trv-input setup-select"
                    onChange={(event) => setIntakeFormId(event.target.value || null)}
                    required
                    value={intakeFormId ?? ''}
                  >
                    {options?.forms.map((form) => (
                      <option key={form.id} value={form.id}>
                        {form.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <div className="invite-payment-note">
                <Badge>Payment later</Badge>
                Client payment does not block onboarding until Stripe Connect is available.
              </div>
            </div>
          </Card>
          <div className="setup-actions">
            <Button disabled={busy || options === null} type="submit">
              {busy ? 'Sending securely...' : 'Send secure invitation'}
            </Button>
            <a className="trv-button trv-button--line" href="#dashboard">
              Cancel
            </a>
            <span className="setup-saved-note">The invitation link expires automatically</span>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

/** Authenticated owner setup flow for S3-S10. */
function CoachSetupApp() {
  const [snapshot, setSnapshot] = useState<CoachSetupSnapshot | null>(null);
  const [activeStep, setActiveStep] = useState<SetupStep>('practice');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const loaded = await setupApi.current();
      setSnapshot(loaded);
      setActiveStep(loaded.nextStep);
    } catch (caught) {
      setLoadError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const run = useMemo(
    () => async (action: SetupAction, next?: SetupStep) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await action();
        setSnapshot(updated);
        setActiveStep(next ?? updated.nextStep);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (loadError !== null) return <LoadError error={loadError} onRetry={() => void load()} />;
  if (snapshot === null) {
    return (
      <main className="load-state" aria-busy="true">
        <span className="trv-wordmark">Traverse</span>
        <p>Opening your practice setup...</p>
      </main>
    );
  }
  if (activeStep === 'dashboard') {
    return <CoachDashboard onReview={() => setActiveStep('practice')} snapshot={snapshot} />;
  }

  let content: ReactNode;
  switch (activeStep) {
    case 'practice':
      content = (
        <PracticeProfileForm
          busy={busy}
          onSave={(input) => void run(() => setupApi.savePracticeProfile(input))}
          snapshot={snapshot}
        />
      );
      break;
    case 'coach':
      content = (
        <CoachProfileForm
          busy={busy}
          onSave={(input) => void run(() => setupApi.saveCoachProfile(input))}
          onUpload={(file) => void run(() => setupApi.uploadProfilePhoto(file), 'coach')}
          snapshot={snapshot}
        />
      );
      break;
    case 'branding':
      content = (
        <OptionalStep
          body="Your client space will use Traverse's calm, accessible defaults. Add your logo and colors later when you are ready."
          busy={busy}
          eyebrow="Branding"
          highlights={[
            'A polished client welcome with accessible color contrast',
            'Your practice and coach names stay prominent',
            'Required privacy and legal links remain available',
          ]}
          onContinue={() => void run(() => setupApi.skipOptional('branding'))}
          title="Your brand can arrive quietly."
        />
      );
      break;
    case 'payments':
      content = (
        <OptionalStep
          body="You do not need Stripe to invite clients or run your practice. Keep handling payments offline and connect your payout account later."
          busy={busy}
          eyebrow="Client payments"
          highlights={[
            'No client payment gate until Stripe is connected',
            'Offline payments can be recorded later',
            'When connected, money goes directly to your Stripe account',
          ]}
          onContinue={() => void run(() => setupApi.skipOptional('payments'))}
          title="Coaching comes before checkout."
        />
      );
      break;
    case 'defaults':
      content = (
        <DefaultsForm
          busy={busy}
          onDefaults={() => void run(() => setupApi.useDefaultOnboarding())}
          onSave={(input) => void run(() => setupApi.saveOnboardingDefaults(input))}
          snapshot={snapshot}
        />
      );
      break;
    case 'policies':
      content = (
        <PoliciesForm
          busy={busy}
          onDefaults={() => void run(() => setupApi.useDefaultPolicies())}
          onSave={(input) => void run(() => setupApi.savePolicies(input))}
          snapshot={snapshot}
        />
      );
      break;
    case 'preview':
      content = (
        <ClientPreview
          busy={busy}
          onBack={() => setActiveStep('coach')}
          onContinue={() => void run(() => setupApi.markPreviewed())}
          snapshot={snapshot}
        />
      );
      break;
    default:
      content = null;
  }

  return (
    <SetupFrame
      activeStep={activeStep}
      busy={busy}
      error={error}
      onNavigate={setActiveStep}
      snapshot={snapshot}
    >
      {content}
    </SetupFrame>
  );
}

export function App() {
  const contractMatch = window.location.pathname.match(/^\/contracts\/([^/]+)\/sign$/);
  if (contractMatch?.[1] !== undefined) {
    return <CoachContractSignaturePage contractId={decodeURIComponent(contractMatch[1])} />;
  }
  return window.location.pathname === '/clients/new' ? <InviteClientPage /> : <CoachSetupApp />;
}
