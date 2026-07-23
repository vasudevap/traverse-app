import {
  ApiResponseError,
  type ClientImportPreview,
  type ClientImportSummary,
  type CoachContractSnapshot,
  type CoachLoopDashboard,
  type CoachLoopWorkspace,
  type CoachSetupSnapshot,
  createAuthApiClient,
  createCoachContractApiClient,
  createCoachDataPortabilityApiClient,
  createCoachInviteApiClient,
  createCoachLoopApiClient,
  createCoachSignupApiClient,
  createCoachSetupApiClient,
  type InviteOptions,
  type LoopAppointment,
  type LoopGroup,
  type PracticeExportSummary,
  type SetupStep,
} from '@traverse/api-client';
import { AppShell, Badge, Button, Card, Field, PageHeader, TextInput } from '@traverse/ui';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultEligibleRelationshipId,
  groupEligibleRelationships,
  isGroupMembershipReady,
  trackerRelationships,
} from './relationships.js';
import { COACH_DASHBOARD_PATH, isCoachDashboardPath } from './routes.js';

const setupApi = createCoachSetupApiClient();
const authApi = createAuthApiClient();
const signupApi = createCoachSignupApiClient();
const inviteApi = createCoachInviteApiClient();
const contractApi = createCoachContractApiClient();
const loopApi = createCoachLoopApiClient();
const dataApi = createCoachDataPortabilityApiClient();
const navigationItems = [
  { href: COACH_DASHBOARD_PATH, label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/groups', label: 'Groups' },
  { href: '/settings/data', label: 'Data' },
  { href: '/logout', label: 'Sign out' },
];

function coachNavigation(pathname = window.location.pathname) {
  return navigationItems.map((item) => ({
    ...item,
    current:
      item.href === COACH_DASHBOARD_PATH
        ? isCoachDashboardPath(pathname)
        : item.href !== '/logout' && pathname === item.href,
  }));
}

const navigation = coachNavigation();

type SetupAction = () => Promise<CoachSetupSnapshot>;

function errorMessage(error: unknown): string {
  if (error instanceof ApiResponseError) return error.message;
  return 'Something went wrong. Your saved work is still safe. Please try again.';
}

function signupErrorMessage(error: unknown): string {
  if (error instanceof ApiResponseError && error.status >= 500) {
    return 'We could not send your verification email. Please try again shortly.';
  }
  return errorMessage(error);
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
            <p className="field-note">
              Your personal coach photo. JPEG, PNG, or WebP, 5 MB maximum. Practice-logo
              configuration is planned for a later release.
            </p>
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
  const [reminderCadenceText, setReminderCadenceText] = useState(
    snapshot.onboardingDefaults.reminderCadenceDays.join(', '),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...defaults,
      reminderCadenceDays: reminderCadenceText
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    });
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
              onChange={(event) => setReminderCadenceText(event.target.value)}
              value={reminderCadenceText}
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
  return <LiveCoachLoop focus="dashboard" onReview={onReview} setupSnapshot={snapshot} />;
}

type CoachLoopFocus = 'calendar' | 'clients' | 'dashboard' | 'groups';

function tomorrowMorning(): string {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(9, 0, 0, 0);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function healthLabel(health: CoachLoopDashboard['relationships'][number]['health']): string {
  const labels = {
    active: 'Recently active',
    awaiting_first_touch: 'Awaiting first touch',
    invited: 'Invitation sent',
    onboarding: 'Onboarding in progress',
    inactive_risk: 'Needs a check-in',
    newly_active: 'Newly active',
    scheduled: 'Session scheduled',
    task_pending: 'Task pending',
  };
  return labels[health];
}

function healthTone(
  health: CoachLoopDashboard['relationships'][number]['health'],
): 'accent' | 'mark' | 'neutral' {
  if (health === 'newly_active' || health === 'scheduled') return 'accent';
  if (
    health === 'awaiting_first_touch' ||
    health === 'inactive_risk' ||
    health === 'invited' ||
    health === 'onboarding'
  ) {
    return 'mark';
  }
  return 'neutral';
}

function LiveCoachLoop({
  focus,
  onReview,
  setupSnapshot,
}: {
  focus: CoachLoopFocus;
  onReview?: () => void;
  setupSnapshot?: CoachSetupSnapshot;
}) {
  const navigation = coachNavigation(
    focus === 'dashboard' ? COACH_DASHBOARD_PATH : window.location.pathname,
  );
  const [dashboard, setDashboard] = useState<CoachLoopDashboard | null>(null);
  const [availability, setAvailability] = useState<
    Awaited<ReturnType<typeof loopApi.listAvailability>>
  >([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'client' | 'group'>('client');
  const [relationshipId, setRelationshipId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [appointmentTypeId, setAppointmentTypeId] = useState('');
  const [appointmentTitle, setAppointmentTitle] = useState('Coaching session');
  const [appointmentStart, setAppointmentStart] = useState(tomorrowMorning);
  const [appointmentDuration, setAppointmentDuration] = useState(60);
  const [meetingLink, setMeetingLink] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [typeName, setTypeName] = useState('Coaching session');
  const [typeDuration, setTypeDuration] = useState(60);
  const [typeSelfBookable, setTypeSelfBookable] = useState(true);
  const [slotStart, setSlotStart] = useState(tomorrowMorning);
  const [slotDuration, setSlotDuration] = useState(60);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [membershipGroupId, setMembershipGroupId] = useState('');
  const [membershipClientId, setMembershipClientId] = useState('');
  const [editingAppointment, setEditingAppointment] = useState<LoopAppointment | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState(tomorrowMorning);
  const relationships = trackerRelationships(dashboard?.relationships);
  const activeRelationships = groupEligibleRelationships(relationships);
  const activeGroups = dashboard?.groups.filter((group) => group.archivedAt === null) ?? [];
  const membershipReady = isGroupMembershipReady({
    activeGroupCount: activeGroups.length,
    clientId: membershipClientId,
    groupId: membershipGroupId,
  });

  async function load() {
    setError(null);
    try {
      const [nextDashboard, nextAvailability] = await Promise.all([
        loopApi.current(),
        loopApi.listAvailability(),
      ]);
      setDashboard(nextDashboard);
      setAvailability(nextAvailability);
      const requestedRelationshipId = new URLSearchParams(window.location.search).get(
        'relationshipId',
      );
      setRelationshipId((current) => {
        if (current) return current;
        if (
          requestedRelationshipId !== null &&
          nextDashboard.relationships.some(
            (relationship) => relationship.id === requestedRelationshipId,
          )
        ) {
          return requestedRelationshipId;
        }
        return defaultEligibleRelationshipId(nextDashboard.relationships);
      });
      setGroupId((current) => current || nextDashboard.groups[0]?.id || '');
      setAppointmentTypeId(
        (current) =>
          current || nextDashboard.appointmentTypes.find((type) => type.active)?.id || '',
      );
      setMembershipGroupId(
        (current) =>
          current || nextDashboard.groups.find((group) => group.archivedAt === null)?.id || '',
      );
      setMembershipClientId(
        (current) =>
          current || groupEligibleRelationships(nextDashboard.relationships)[0]?.client.id || '',
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function createAppointment(event: FormEvent) {
    event.preventDefault();
    const startsAt = new Date(appointmentStart);
    const endsAt = new Date(startsAt.getTime() + appointmentDuration * 60_000);
    void run('appointment', () =>
      loopApi.createAppointment({
        appointmentTypeId: appointmentTypeId || null,
        endsAt: endsAt.toISOString(),
        groupId: targetType === 'group' ? groupId : null,
        meetingLink,
        notes: appointmentNotes,
        relationshipId: targetType === 'client' ? relationshipId : null,
        startsAt: startsAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        title: appointmentTitle,
      }),
    );
  }

  function createTask(event: FormEvent) {
    event.preventDefault();
    void run('task', async () => {
      await loopApi.createTask({
        description: taskDescription,
        dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : null,
        relationshipId,
        title: taskTitle,
      });
      setTaskTitle('');
      setTaskDescription('');
    });
  }

  function createType(event: FormEvent) {
    event.preventDefault();
    void run('type', () =>
      loopApi.createAppointmentType({
        currency: null,
        defaultDurationMinutes: typeDuration,
        name: typeName,
        notes: '',
        priceAmount: null,
        selfBookable: typeSelfBookable,
      }),
    );
  }

  function createSlot(event: FormEvent) {
    event.preventDefault();
    const startsAt = new Date(slotStart);
    void run('slot', () =>
      loopApi.createAvailability({
        endsAt: new Date(startsAt.getTime() + slotDuration * 60_000).toISOString(),
        startsAt: startsAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        type: 'slot',
      }),
    );
  }

  function createGroup(event: FormEvent) {
    event.preventDefault();
    void run('group', async () => {
      await loopApi.createGroup({ description: groupDescription, name: groupName });
      setGroupName('');
      setGroupDescription('');
    });
  }

  function reschedule(event: FormEvent) {
    event.preventDefault();
    if (editingAppointment === null) return;
    const startsAt = new Date(rescheduleStart);
    const duration =
      new Date(editingAppointment.endsAt).getTime() -
      new Date(editingAppointment.startsAt).getTime();
    void run(`move-${editingAppointment.id}`, async () => {
      await loopApi.updateAppointment(editingAppointment.id, {
        action: 'reschedule',
        endsAt: new Date(startsAt.getTime() + duration).toISOString(),
        meetingLink: editingAppointment.meetingLink ?? '',
        notes: editingAppointment.notes ?? '',
        startsAt: startsAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setEditingAppointment(null);
    });
  }

  if (dashboard === null) {
    if (error !== null) return <LoadError error={error} onRetry={() => void load()} />;
    return (
      <main className="load-state" aria-busy="true">
        <span className="trv-wordmark">Traverse</span>
        <p>Opening your coaching workspace...</p>
      </main>
    );
  }

  const headings = {
    calendar: {
      eyebrow: 'Scheduling',
      summary: 'Create sessions, offer bookable times, and keep calendars in sync.',
      title: 'Calendar',
    },
    clients: {
      eyebrow: 'Relationships',
      summary: 'See who needs attention and move straight into the relationship workspace.',
      title: 'Clients',
    },
    dashboard: {
      eyebrow: 'Coach operating view',
      summary: 'The next useful action for every active coaching relationship.',
      title: `Welcome, ${dashboard.coachName.split(' ')[0] || 'Coach'}`,
    },
    groups: {
      eyebrow: 'Cohorts',
      summary: 'Organize clients into groups and schedule shared sessions.',
      title: 'Groups',
    },
  };
  const heading = headings[focus];

  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        actions={
          <div className="coach-loop-actions">
            <a className="trv-button trv-button--primary" href="/clients/new">
              Invite a client
            </a>
            {onReview ? (
              <Button onClick={onReview} type="button" variant="line">
                Practice settings
              </Button>
            ) : null}
          </div>
        }
        eyebrow={heading.eyebrow}
        summary={heading.summary}
        title={heading.title}
      />
      {error ? (
        <div className="setup-alert" role="alert">
          {error}
        </div>
      ) : null}

      {focus === 'dashboard' || focus === 'clients' ? (
        <div className="coach-loop-stack">
          {dashboard.relationships.length === 0 ? (
            <Card className="dashboard-ready-card" tone="editorial">
              <div className="dashboard-ready-card__mark" aria-hidden="true">
                ✓
              </div>
              <div>
                <div className="trv-eyebrow">Practice ready</div>
                <h2>{setupSnapshot?.practice.displayName ?? 'Your practice'} is ready.</h2>
                <p>Invite a client to begin the active coaching loop.</p>
                <a className="trv-button trv-button--primary" href="/clients/new">
                  Invite your first client
                </a>
              </div>
            </Card>
          ) : (
            <section className="coach-loop-section">
              <div className="coach-loop-section__heading">
                <div>
                  <div className="trv-eyebrow">Needs attention</div>
                  <h2>Client relationships</h2>
                </div>
                <Badge tone="neutral">{relationships.length} total</Badge>
              </div>
              <div className="coach-relationship-grid">
                {relationships.map((relationship) => (
                  <Card className="coach-relationship-card" key={relationship.id}>
                    <div className="coach-relationship-card__top">
                      <div>
                        <h3>{relationship.client.name}</h3>
                        <span>{relationship.client.email}</span>
                      </div>
                      <Badge tone={healthTone(relationship.health)}>
                        {healthLabel(relationship.health)}
                      </Badge>
                    </div>
                    <div className="coach-relationship-card__facts">
                      {relationship.health === 'invited' ? (
                        <span>
                          Invitation expires{' '}
                          {relationship.inviteExpiresAt
                            ? new Date(relationship.inviteExpiresAt).toLocaleDateString()
                            : 'soon'}
                        </span>
                      ) : (
                        <>
                          <span>{relationship.openTaskCount} open tasks</span>
                          <span>
                            {relationship.nextAppointment
                              ? formatWhen(relationship.nextAppointment.startsAt)
                              : 'No session booked'}
                          </span>
                        </>
                      )}
                    </div>
                    {relationship.health === 'invited' ||
                    relationship.health === 'onboarding' ? null : (
                      <a
                        className="trv-button trv-button--line"
                        href={`/clients/${encodeURIComponent(relationship.id)}`}
                      >
                        Open client workspace
                      </a>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section className="coach-loop-section">
            <div className="coach-loop-section__heading">
              <div>
                <div className="trv-eyebrow">Coming up</div>
                <h2>Upcoming appointments</h2>
              </div>
              <a className="trv-button trv-button--line" href="/calendar">
                Manage calendar
              </a>
            </div>
            <AppointmentList
              appointments={dashboard.upcomingAppointments}
              busy={busy}
              onAction={(appointment, action) =>
                void run(`${action}-${appointment.id}`, () =>
                  loopApi.updateAppointment(appointment.id, { action }),
                )
              }
              onReschedule={(appointment) => {
                setEditingAppointment(appointment);
                const value = new Date(appointment.startsAt);
                const offset = value.getTimezoneOffset() * 60_000;
                setRescheduleStart(new Date(value.getTime() - offset).toISOString().slice(0, 16));
              }}
            />
          </section>
        </div>
      ) : null}

      {focus === 'calendar' ? (
        <div className="coach-loop-stack">
          <div className="coach-loop-form-grid">
            <form className="coach-loop-form" onSubmit={createAppointment}>
              <Card>
                <div className="trv-eyebrow">New appointment</div>
                <h2>Schedule a session</h2>
                <Field label="Target">
                  <select
                    className="trv-input"
                    onChange={(event) => setTargetType(event.target.value as 'client' | 'group')}
                    value={targetType}
                  >
                    <option value="client">Client</option>
                    <option value="group">Group</option>
                  </select>
                </Field>
                <Field label={targetType === 'client' ? 'Client' : 'Group'}>
                  <select
                    className="trv-input"
                    onChange={(event) =>
                      targetType === 'client'
                        ? setRelationshipId(event.target.value)
                        : setGroupId(event.target.value)
                    }
                    required
                    value={targetType === 'client' ? relationshipId : groupId}
                  >
                    {(targetType === 'client' ? (activeRelationships ?? []) : dashboard.groups).map(
                      (target) => (
                        <option key={target.id} value={target.id}>
                          {'client' in target ? target.client.name : target.name}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field label="Appointment type">
                  <select
                    className="trv-input"
                    onChange={(event) => setAppointmentTypeId(event.target.value)}
                    value={appointmentTypeId}
                  >
                    <option value="">No type</option>
                    {dashboard.appointmentTypes
                      .filter((type) => type.active)
                      .map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Title">
                  <TextInput
                    maxLength={200}
                    onChange={(event) => setAppointmentTitle(event.target.value)}
                    required
                    value={appointmentTitle}
                  />
                </Field>
                <div className="coach-loop-inline-fields">
                  <Field label="Starts">
                    <TextInput
                      onChange={(event) => setAppointmentStart(event.target.value)}
                      required
                      type="datetime-local"
                      value={appointmentStart}
                    />
                  </Field>
                  <Field label="Minutes">
                    <TextInput
                      max={480}
                      min={5}
                      onChange={(event) => setAppointmentDuration(Number(event.target.value))}
                      required
                      type="number"
                      value={appointmentDuration}
                    />
                  </Field>
                </div>
                <Field hint="Optional HTTPS Zoom, Teams, or Meet link" label="Meeting link">
                  <TextInput
                    onChange={(event) => setMeetingLink(event.target.value)}
                    type="url"
                    value={meetingLink}
                  />
                </Field>
                <Field hint="Optional" label="Agenda or notes">
                  <textarea
                    className="trv-input coach-loop-textarea"
                    maxLength={4000}
                    onChange={(event) => setAppointmentNotes(event.target.value)}
                    value={appointmentNotes}
                  />
                </Field>
                <Button disabled={busy === 'appointment'} type="submit">
                  {busy === 'appointment' ? 'Scheduling...' : 'Save appointment'}
                </Button>
              </Card>
            </form>

            <form className="coach-loop-form" onSubmit={createTask}>
              <Card tone="editorial">
                <div className="trv-eyebrow">Accountability</div>
                <h2>Assign a task</h2>
                <Field label="Client">
                  <select
                    className="trv-input"
                    onChange={(event) => setRelationshipId(event.target.value)}
                    required
                    value={relationshipId}
                  >
                    {(activeRelationships ?? []).map((relationship) => (
                      <option key={relationship.id} value={relationship.id}>
                        {relationship.client.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Task">
                  <TextInput
                    maxLength={200}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    required
                    value={taskTitle}
                  />
                </Field>
                <Field hint="Optional" label="Description">
                  <textarea
                    className="trv-input coach-loop-textarea"
                    maxLength={4000}
                    onChange={(event) => setTaskDescription(event.target.value)}
                    value={taskDescription}
                  />
                </Field>
                <Field hint="Optional" label="Due date">
                  <TextInput
                    onChange={(event) => setTaskDueAt(event.target.value)}
                    type="datetime-local"
                    value={taskDueAt}
                  />
                </Field>
                <Button disabled={busy === 'task'} type="submit">
                  {busy === 'task' ? 'Assigning...' : 'Assign task'}
                </Button>
              </Card>
            </form>
          </div>

          {editingAppointment ? (
            <form className="coach-loop-reschedule" onSubmit={reschedule}>
              <Card tone="editorial">
                <div>
                  <div className="trv-eyebrow">Reschedule</div>
                  <h2>{editingAppointment.title}</h2>
                </div>
                <Field label="New start">
                  <TextInput
                    onChange={(event) => setRescheduleStart(event.target.value)}
                    required
                    type="datetime-local"
                    value={rescheduleStart}
                  />
                </Field>
                <div className="coach-loop-actions">
                  <Button disabled={busy === `move-${editingAppointment.id}`} type="submit">
                    Save new time
                  </Button>
                  <Button onClick={() => setEditingAppointment(null)} type="button" variant="line">
                    Cancel
                  </Button>
                </div>
              </Card>
            </form>
          ) : null}

          <AppointmentList
            appointments={dashboard.upcomingAppointments}
            busy={busy}
            onAction={(appointment, action) =>
              void run(`${action}-${appointment.id}`, () =>
                loopApi.updateAppointment(appointment.id, { action }),
              )
            }
            onReschedule={(appointment) => {
              setEditingAppointment(appointment);
              const value = new Date(appointment.startsAt);
              const offset = value.getTimezoneOffset() * 60_000;
              setRescheduleStart(new Date(value.getTime() - offset).toISOString().slice(0, 16));
            }}
          />

          <div className="coach-loop-form-grid">
            <form className="coach-loop-form" onSubmit={createType}>
              <Card>
                <div className="trv-eyebrow">Configuration</div>
                <h2>Appointment types</h2>
                <Field label="Name">
                  <TextInput
                    maxLength={120}
                    onChange={(event) => setTypeName(event.target.value)}
                    required
                    value={typeName}
                  />
                </Field>
                <Field label="Default minutes">
                  <TextInput
                    max={480}
                    min={5}
                    onChange={(event) => setTypeDuration(Number(event.target.value))}
                    required
                    type="number"
                    value={typeDuration}
                  />
                </Field>
                <label className="coach-loop-check">
                  <input
                    checked={typeSelfBookable}
                    onChange={(event) => setTypeSelfBookable(event.target.checked)}
                    type="checkbox"
                  />
                  Clients can book proposed slots with this type
                </label>
                <Button disabled={busy === 'type'} type="submit">
                  Add appointment type
                </Button>
                <div className="coach-loop-compact-list">
                  {dashboard.appointmentTypes.map((type) => (
                    <div key={type.id}>
                      <span>
                        <strong>{type.name}</strong>
                        <small>{type.defaultDurationMinutes} minutes</small>
                      </span>
                      <Button
                        disabled={busy === `type-${type.id}`}
                        onClick={() =>
                          void run(`type-${type.id}`, () =>
                            loopApi.updateAppointmentType(type.id, { active: !type.active }),
                          )
                        }
                        type="button"
                        variant="quiet"
                      >
                        {type.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            </form>

            <form className="coach-loop-form" onSubmit={createSlot}>
              <Card>
                <div className="trv-eyebrow">Self-booking</div>
                <h2>Propose a time</h2>
                <Field label="Starts">
                  <TextInput
                    onChange={(event) => setSlotStart(event.target.value)}
                    required
                    type="datetime-local"
                    value={slotStart}
                  />
                </Field>
                <Field label="Minutes">
                  <TextInput
                    max={480}
                    min={5}
                    onChange={(event) => setSlotDuration(Number(event.target.value))}
                    required
                    type="number"
                    value={slotDuration}
                  />
                </Field>
                <Button disabled={busy === 'slot'} type="submit">
                  Offer this time
                </Button>
                <div className="coach-loop-compact-list">
                  {availability.map((slot) => (
                    <div key={slot.id}>
                      <span>
                        <strong>
                          {slot.startsAt ? formatWhen(slot.startsAt) : 'Weekly availability'}
                        </strong>
                        <small>{slot.timezone}</small>
                      </span>
                      <Button
                        disabled={busy === `slot-${slot.id}`}
                        onClick={() =>
                          void run(`slot-${slot.id}`, () => loopApi.removeAvailability(slot.id))
                        }
                        type="button"
                        variant="quiet"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            </form>
          </div>
        </div>
      ) : null}

      {focus === 'groups' ? (
        <div className="coach-loop-stack">
          <div className="coach-loop-form-grid">
            <form className="coach-loop-form" onSubmit={createGroup}>
              <Card>
                <div className="trv-eyebrow">New cohort</div>
                <h2>Create a group</h2>
                <Field label="Group name">
                  <TextInput
                    maxLength={120}
                    onChange={(event) => setGroupName(event.target.value)}
                    required
                    value={groupName}
                  />
                </Field>
                <Field hint="Optional" label="Description">
                  <textarea
                    className="trv-input coach-loop-textarea"
                    maxLength={2000}
                    onChange={(event) => setGroupDescription(event.target.value)}
                    value={groupDescription}
                  />
                </Field>
                <Button disabled={busy === 'group'} type="submit">
                  Create group
                </Button>
              </Card>
            </form>

            <form
              className="coach-loop-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!membershipReady) return;
                void run('member', () =>
                  loopApi.addGroupMember(membershipGroupId, membershipClientId),
                );
              }}
            >
              <Card tone="editorial">
                <div className="trv-eyebrow">Membership</div>
                <h2>Add a client</h2>
                <Field label="Group">
                  <select
                    className="trv-input"
                    disabled={activeGroups.length === 0}
                    onChange={(event) => setMembershipGroupId(event.target.value)}
                    required
                    value={membershipGroupId}
                  >
                    {activeGroups.length === 0 ? (
                      <option value="">Create a group first</option>
                    ) : (
                      activeGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
                <Field
                  hint={
                    (activeRelationships ?? []).length === 0
                      ? 'Clients become eligible after they complete onboarding.'
                      : undefined
                  }
                  label="Client"
                >
                  <select
                    className="trv-input"
                    disabled={(activeRelationships ?? []).length === 0}
                    onChange={(event) => setMembershipClientId(event.target.value)}
                    required
                    value={membershipClientId}
                  >
                    {(activeRelationships ?? []).length === 0 ? (
                      <option value="">No active clients yet</option>
                    ) : (
                      (activeRelationships ?? []).map((relationship) => (
                        <option key={relationship.client.id} value={relationship.client.id}>
                          {relationship.client.name}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
                <Button disabled={busy === 'member' || !membershipReady} type="submit">
                  Add to group
                </Button>
              </Card>
            </form>
          </div>

          <div className="coach-group-grid">
            {dashboard.groups.map((group) => (
              <GroupCard
                busy={busy}
                group={group}
                key={group.id}
                onArchive={() =>
                  void run(`group-${group.id}`, () =>
                    loopApi.updateGroup(group.id, {
                      archived: group.archivedAt === null,
                      description: group.description ?? '',
                      name: group.name,
                    }),
                  )
                }
                onRemove={(clientId) =>
                  void run(`member-${group.id}-${clientId}`, () =>
                    loopApi.removeGroupMember(group.id, clientId),
                  )
                }
              />
            ))}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function AppointmentList({
  appointments,
  busy,
  onAction,
  onReschedule,
}: {
  appointments: LoopAppointment[];
  busy: string | null;
  onAction(appointment: LoopAppointment, action: 'cancel' | 'complete'): void;
  onReschedule(appointment: LoopAppointment): void;
}) {
  if (appointments.length === 0) {
    return (
      <Card tone="editorial">
        <p className="coach-loop-muted">No upcoming appointments.</p>
      </Card>
    );
  }
  return (
    <Card>
      {appointments.map((appointment) => (
        <div className="coach-appointment-row" key={appointment.id}>
          <div>
            <div className="coach-appointment-row__title">
              <h3>{appointment.title}</h3>
              <Badge tone={appointment.bookedByClient ? 'accent' : 'neutral'}>
                {appointment.bookedByClient ? 'Client booked' : appointment.target.type}
              </Badge>
            </div>
            <p>
              {formatWhen(appointment.startsAt)} · {appointment.target.name}
            </p>
          </div>
          <div className="coach-loop-actions">
            <a className="trv-button trv-button--line" href={appointment.calendarUrl}>
              iCal
            </a>
            <Button onClick={() => onReschedule(appointment)} type="button" variant="line">
              Reschedule
            </Button>
            <Button
              disabled={busy === `complete-${appointment.id}`}
              onClick={() => onAction(appointment, 'complete')}
              type="button"
              variant="quiet"
            >
              Complete
            </Button>
            <Button
              disabled={busy === `cancel-${appointment.id}`}
              onClick={() => onAction(appointment, 'cancel')}
              type="button"
              variant="quiet"
            >
              Cancel
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function GroupCard({
  busy,
  group,
  onArchive,
  onRemove,
}: {
  busy: string | null;
  group: LoopGroup;
  onArchive(): void;
  onRemove(clientId: string): void;
}) {
  return (
    <Card>
      <div className="coach-relationship-card__top">
        <div>
          <h3>{group.name}</h3>
          <p>{group.description ?? 'A coaching cohort'}</p>
        </div>
        <Badge tone={group.archivedAt === null ? 'accent' : 'neutral'}>
          {group.archivedAt === null ? 'Active' : 'Archived'}
        </Badge>
      </div>
      <div className="coach-loop-compact-list">
        {group.members.length === 0 ? (
          <p className="coach-loop-muted">No members yet.</p>
        ) : (
          group.members.map((member) => (
            <div key={member.clientId}>
              <strong>{member.name}</strong>
              <Button
                disabled={busy === `member-${group.id}-${member.clientId}`}
                onClick={() => onRemove(member.clientId)}
                type="button"
                variant="quiet"
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
      <Button
        disabled={busy === `group-${group.id}`}
        onClick={onArchive}
        type="button"
        variant="line"
      >
        {group.archivedAt === null ? 'Archive group' : 'Restore group'}
      </Button>
    </Card>
  );
}

function CoachWorkspacePage({ relationshipId }: { relationshipId: string }) {
  const [workspace, setWorkspace] = useState<CoachLoopWorkspace | null>(null);
  const [notes, setNotes] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const loaded = await loopApi.workspace(relationshipId);
      setWorkspace(loaded);
      setNotes(loaded.notes);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  useEffect(() => {
    void load();
  }, [relationshipId]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (workspace === null) {
    return (
      <LoadError error={error ?? 'Opening the client workspace...'} onRetry={() => void load()} />
    );
  }

  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        actions={
          <a
            className="trv-button trv-button--primary"
            href={`/calendar?relationshipId=${encodeURIComponent(workspace.id)}`}
          >
            Schedule session
          </a>
        }
        eyebrow="Client workspace"
        summary={`${workspace.client.email}${workspace.client.phone ? ` · ${workspace.client.phone}` : ''}`}
        title={workspace.client.name}
      />
      {error ? (
        <div className="setup-alert" role="alert">
          {error}
        </div>
      ) : null}
      <div className="coach-loop-stack">
        <div className="coach-workspace-grid">
          <Card>
            <div className="trv-eyebrow">Relationship notes · encrypted</div>
            <h2>Private coaching notes</h2>
            <textarea
              className="trv-input coach-notes-textarea"
              maxLength={20000}
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
            <Button
              disabled={busy === 'notes'}
              onClick={() => void run('notes', () => loopApi.saveNotes(workspace.id, notes))}
              type="button"
            >
              {busy === 'notes' ? 'Encrypting...' : 'Save notes securely'}
            </Button>
          </Card>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run('task', async () => {
                await loopApi.createTask({
                  description: taskDescription,
                  dueAt: null,
                  relationshipId: workspace.id,
                  title: taskTitle,
                });
                setTaskTitle('');
                setTaskDescription('');
              });
            }}
          >
            <Card tone="editorial">
              <div className="trv-eyebrow">Next commitment</div>
              <h2>Assign a task</h2>
              <Field label="Task">
                <TextInput
                  maxLength={200}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  required
                  value={taskTitle}
                />
              </Field>
              <Field hint="Optional" label="Description">
                <textarea
                  className="trv-input coach-loop-textarea"
                  maxLength={4000}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  value={taskDescription}
                />
              </Field>
              <Button disabled={busy === 'task'} type="submit">
                Assign task
              </Button>
            </Card>
          </form>
        </div>
        <section className="coach-loop-section">
          <div className="coach-loop-section__heading">
            <div>
              <div className="trv-eyebrow">Sessions</div>
              <h2>Appointment history</h2>
            </div>
          </div>
          <AppointmentList
            appointments={workspace.appointments.filter(
              (appointment) =>
                appointment.status === 'scheduled' || appointment.status === 'booked',
            )}
            busy={busy}
            onAction={(appointment, action) =>
              void run(`${action}-${appointment.id}`, () =>
                loopApi.updateAppointment(appointment.id, { action }),
              )
            }
            onReschedule={() => {
              window.location.href = `/calendar?relationshipId=${encodeURIComponent(workspace.id)}`;
            }}
          />
        </section>
        <section className="coach-loop-section">
          <div className="coach-loop-section__heading">
            <div>
              <div className="trv-eyebrow">Tasks</div>
              <h2>Accountability history</h2>
            </div>
          </div>
          <Card>
            {workspace.tasks.length === 0 ? (
              <p className="coach-loop-muted">No tasks assigned yet.</p>
            ) : (
              workspace.tasks.map((task) => (
                <div className="coach-task-row" key={task.id}>
                  <div>
                    <h3>{task.title}</h3>
                    <p>{task.description ?? 'No description'}</p>
                  </div>
                  <div className="coach-loop-actions">
                    <Badge tone={task.status === 'completed' ? 'accent' : 'neutral'}>
                      {task.status}
                    </Badge>
                    <Button
                      disabled={busy === `task-${task.id}`}
                      onClick={() =>
                        void run(`task-${task.id}`, () =>
                          loopApi.updateTask(
                            task.id,
                            task.status === 'completed' || task.status === 'canceled'
                              ? 'reopen'
                              : 'cancel',
                          ),
                        )
                      }
                      type="button"
                      variant="quiet"
                    >
                      {task.status === 'assigned' ? 'Cancel' : 'Reopen'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>
        </section>
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

function CoachSignOut() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authApi
      .logout('coach')
      .then(() => window.location.replace('/'))
      .catch((caught) => setError(errorMessage(caught)));
  }, []);

  return (
    <main className="load-state" aria-busy={error === null}>
      <span className="trv-wordmark">Traverse</span>
      <Card>
        <div className="trv-eyebrow">Coach account</div>
        <h1>{error ? 'We could not sign you out.' : 'Signing you out...'}</h1>
        {error ? (
          <>
            <p>{error}</p>
            <Button onClick={() => window.location.reload()} type="button">
              Try again
            </Button>
          </>
        ) : (
          <p>Closing your Coach App session.</p>
        )}
      </Card>
    </main>
  );
}

function CoachSignIn({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit(email: string, password: string): void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(email, password);
  }

  return (
    <main className="load-state coach-access">
      <span className="trv-wordmark">Traverse</span>
      <Card>
        <div className="trv-eyebrow">Coach app</div>
        <h1>Welcome back.</h1>
        <p>Sign in to continue setting up your practice and supporting your clients.</p>
        {error ? (
          <div className="setup-alert" role="alert">
            {error}
          </div>
        ) : null}
        <form className="coach-access__form" onSubmit={submit}>
          <Field label="Email address">
            <TextInput
              autoComplete="email"
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </Field>
          <Field label="Password">
            <TextInput
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          <Button disabled={busy} type="submit">
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
        <p className="coach-access__help">
          New to Traverse? <a href="/signup">Create your coach account.</a>
        </p>
      </Card>
    </main>
  );
}

function CoachSignup() {
  type SignupStep = 'account' | 'agreements' | 'plan';
  type SignupPlanCode = 'established' | 'practice' | 'starter';
  const plans: Array<{
    annual: number;
    code: SignupPlanCode;
    detail: string;
    monthly: number;
    name: string;
  }> = [
    {
      annual: 190,
      code: 'starter',
      detail: '40 clients · 30-day video retention',
      monthly: 19,
      name: 'Basic',
    },
    {
      annual: 390,
      code: 'practice',
      detail: '75 clients · 180-day video retention',
      monthly: 39,
      name: 'Pro',
    },
    {
      annual: 790,
      code: 'established',
      detail: 'Unlimited clients · 365-day retention',
      monthly: 79,
      name: 'Premium',
    },
  ];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [step, setStep] = useState<SignupStep>('plan');
  const [planCode, setPlanCode] = useState<SignupPlanCode>('practice');
  const [billingInterval, setBillingInterval] = useState<'annual' | 'monthly'>('monthly');
  const [discipline, setDiscipline] = useState('');
  const [disciplineBand, setDisciplineBand] = useState<'permitted' | 'restricted'>('permitted');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [acceptableUseAccepted, setAcceptableUseAccepted] = useState(false);
  const [restrictedCredentialAttestation, setRestrictedCredentialAttestation] = useState(false);
  const [restrictedNonClinicalAttestation, setRestrictedNonClinicalAttestation] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    setBusy(true);
    setError(null);
    setResendEmail(null);
    try {
      await signupApi.create({
        acceptableUseAccepted,
        billingInterval,
        discipline,
        disciplineBand,
        email,
        legalAccepted,
        name: String(form.get('name') ?? '').trim(),
        password: String(form.get('password') ?? ''),
        planCode,
        practiceName: String(form.get('practice-name') ?? '').trim(),
        restrictedCredentialAttestation,
        restrictedNonClinicalAttestation,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSubmittedEmail(email);
    } catch (caught) {
      setError(signupErrorMessage(caught));
      if (caught instanceof ApiResponseError && caught.status === 409) {
        setResendEmail(email);
      }
    } finally {
      setBusy(false);
    }
  }

  function continueFromAgreements(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStep('account');
  }

  async function resendVerification() {
    if (resendEmail === null) return;
    setBusy(true);
    setError(null);
    try {
      await signupApi.resendVerificationEmail(resendEmail);
      setSubmittedEmail(resendEmail);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (submittedEmail !== null) {
    return (
      <main className="load-state coach-access">
        <span className="trv-wordmark">Traverse</span>
        <Card>
          <div className="trv-eyebrow">Coach account</div>
          <h1>Check your email.</h1>
          <p>We sent a verification link to {submittedEmail}. Open it to start your trial.</p>
          <p className="coach-access__help">
            <a href="/">Return to sign in</a>
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="load-state coach-access coach-access--wide">
      <span className="trv-wordmark">Traverse</span>
      <Card>
        <div className="coach-access__progress" aria-label="Signup progress">
          <span className={step === 'plan' ? 'is-current' : ''}>1 Plan</span>
          <span className={step === 'agreements' ? 'is-current' : ''}>2 Agreements</span>
          <span className={step === 'account' ? 'is-current' : ''}>3 Account</span>
        </div>
        {error ? (
          <div className="setup-alert" role="alert">
            {error}
          </div>
        ) : null}
        {resendEmail !== null ? (
          <Button disabled={busy} onClick={() => void resendVerification()} type="button">
            {busy ? 'Sending verification email...' : 'Resend verification email'}
          </Button>
        ) : null}
        {step === 'plan' ? (
          <section>
            <div className="trv-eyebrow">Choose your plan</div>
            <h1>Start with 14 days free.</h1>
            <p>
              No card today. Add a payment method and confirm your plan before paid access begins.
            </p>
            <div className="coach-access__interval" role="group" aria-label="Billing interval">
              <button
                className={billingInterval === 'monthly' ? 'is-selected' : ''}
                onClick={() => setBillingInterval('monthly')}
                type="button"
              >
                Monthly
              </button>
              <button
                className={billingInterval === 'annual' ? 'is-selected' : ''}
                onClick={() => setBillingInterval('annual')}
                type="button"
              >
                Annual · two months free
              </button>
            </div>
            <div className="coach-access__plans">
              {plans.map((plan) => (
                <button
                  className={
                    planCode === plan.code ? 'coach-access__plan is-selected' : 'coach-access__plan'
                  }
                  key={plan.code}
                  onClick={() => setPlanCode(plan.code)}
                  type="button"
                >
                  <strong>{plan.name}</strong>
                  <span className="coach-access__price">
                    ${billingInterval === 'monthly' ? plan.monthly : plan.annual}
                    <small> USD/{billingInterval === 'monthly' ? 'month' : 'year'}</small>
                  </span>
                  <span>{plan.detail}</span>
                  {plan.code === 'practice' ? <em>Most popular</em> : null}
                </button>
              ))}
            </div>
            <Button onClick={() => setStep('agreements')} type="button">
              Continue with {plans.find((plan) => plan.code === planCode)?.name}
            </Button>
          </section>
        ) : null}
        {step === 'agreements' ? (
          <form className="coach-access__form" onSubmit={continueFromAgreements}>
            <div className="trv-eyebrow">Agreements and acceptable use</div>
            <h1>Confirm how you coach.</h1>
            <Field label="Primary coaching discipline">
              <TextInput
                onChange={(event) => setDiscipline(event.target.value)}
                required
                value={discipline}
              />
            </Field>
            <label className="coach-access__choice">
              Discipline category
              <select
                onChange={(event) =>
                  setDisciplineBand(event.target.value as 'permitted' | 'restricted')
                }
                value={disciplineBand}
              >
                <option value="permitted">Permitted coaching</option>
                <option value="restricted">Restricted coaching</option>
              </select>
            </label>
            {disciplineBand === 'restricted' ? (
              <>
                <label className="coach-access__check">
                  <input
                    checked={restrictedNonClinicalAttestation}
                    onChange={(event) => setRestrictedNonClinicalAttestation(event.target.checked)}
                    required
                    type="checkbox"
                  />{' '}
                  My services are educational and non-clinical / non-advisory.
                </label>
                <label className="coach-access__check">
                  <input
                    checked={restrictedCredentialAttestation}
                    onChange={(event) => setRestrictedCredentialAttestation(event.target.checked)}
                    required
                    type="checkbox"
                  />{' '}
                  I hold any credential or licence my jurisdiction requires.
                </label>
              </>
            ) : null}
            <label className="coach-access__check">
              <input
                checked={acceptableUseAccepted}
                onChange={(event) => setAcceptableUseAccepted(event.target.checked)}
                required
                type="checkbox"
              />{' '}
              I will not use Traverse for licensed clinical, medical, mental-health, or regulated
              financial or legal services. I am responsible for the lawfulness and suitability of my
              coaching.
            </label>
            <label className="coach-access__check">
              <input
                checked={legalAccepted}
                onChange={(event) => setLegalAccepted(event.target.checked)}
                required
                type="checkbox"
              />{' '}
              I have read and agree to the Coach Terms, Acceptable Use Policy, Privacy Policy, and
              Payment Terms.
            </label>
            <p className="coach-access__legal-note">
              Agreement links and counsel-approved versions must be published before real-user
              launch.
            </p>
            <div className="coach-access__actions">
              <button className="coach-access__back" onClick={() => setStep('plan')} type="button">
                Back
              </button>
              <Button type="submit">Continue to account</Button>
            </div>
          </form>
        ) : null}
        {step === 'account' ? (
          <form className="coach-access__form" onSubmit={(event) => void submit(event)}>
            <div className="trv-eyebrow">Create your practice</div>
            <h1>Set up your {plans.find((plan) => plan.code === planCode)?.name} trial.</h1>
            <p>Verify your email to start the 14-day trial. No card is required today.</p>
            <Field label="Your name">
              <TextInput name="name" required />
            </Field>
            <Field label="Practice name">
              <TextInput name="practice-name" required />
            </Field>
            <Field label="Email address">
              <TextInput autoComplete="email" name="email" required type="email" />
            </Field>
            <Field label="Password" hint="At least 12 characters">
              <TextInput
                autoComplete="new-password"
                minLength={12}
                name="password"
                required
                type="password"
              />
            </Field>
            <div className="coach-access__actions">
              <button
                className="coach-access__back"
                onClick={() => setStep('agreements')}
                type="button"
              >
                Back
              </button>
              <Button disabled={busy} type="submit">
                {busy ? 'Creating account...' : 'Create practice'}
              </Button>
            </div>
          </form>
        ) : null}
        <p className="coach-access__help">
          Already have an account? <a href="/">Sign in</a>
        </p>
      </Card>
    </main>
  );
}

function CoachEmailVerification() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'verified'>('loading');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token === null) {
      setError('This verification link is incomplete.');
      return;
    }
    void signupApi
      .verifyEmail(token)
      .then(() => setStatus('verified'))
      .catch((caught) => setError(errorMessage(caught)));
  }, []);

  return (
    <main className="load-state coach-access">
      <span className="trv-wordmark">Traverse</span>
      <Card>
        <div className="trv-eyebrow">Coach account</div>
        <h1>{status === 'verified' ? 'Your email is verified.' : 'Verifying your email...'}</h1>
        {error ? (
          <div className="setup-alert" role="alert">
            {error}
          </div>
        ) : null}
        {status === 'verified' ? (
          <p>
            You can now <a href="/">sign in and set up your practice</a>.
          </p>
        ) : null}
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
              <a className="trv-button trv-button--primary" href={COACH_DASHBOARD_PATH}>
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
  const [signInRequired, setSignInRequired] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    try {
      await authApi.currentSession('coach');
      const loaded = await setupApi.current();
      setSnapshot(loaded);
      setActiveStep(loaded.nextStep);
    } catch (caught) {
      if (caught instanceof ApiResponseError && caught.status === 401) {
        setSignInRequired(true);
        return;
      }
      setLoadError(errorMessage(caught));
    }
  }

  async function signIn(email: string, password: string) {
    setBusy(true);
    setSignInError(null);
    try {
      await authApi.login('coach', email, password);
      setSignInRequired(false);
      await load();
    } catch (caught) {
      setSignInError(
        caught instanceof ApiResponseError && caught.status === 401
          ? "We couldn't sign you in with those details."
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
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

  if (signInRequired) {
    return (
      <CoachSignIn
        busy={busy}
        error={signInError}
        onSubmit={(email, password) => void signIn(email, password)}
      />
    );
  }
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
          body="Your client space currently uses Traverse's calm, accessible defaults. Logo and color configuration are planned for a later release and are not available yet."
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
          body="You do not need Stripe to invite clients or run your practice. Keep handling payments offline. Stripe payout-account configuration is planned for a later release and is not available yet."
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
      onNavigate={(step) => {
        setError(null);
        setActiveStep(step);
      }}
      snapshot={snapshot}
    >
      {content}
    </SetupFrame>
  );
}

const CLIENT_IMPORT_TEMPLATE =
  'name,email,notes,tags\nAlex Morgan,alex@example.com,Leadership goals,leadership;executive\n';

function dateLabel(value: string | null): string {
  if (value === null) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function byteLabel(value: number | null): string {
  if (value === null) return '';
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function DataPortabilityPage() {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<ClientImportPreview | null>(null);
  const [imports, setImports] = useState<ClientImportSummary[]>([]);
  const [exports, setExports] = useState<PracticeExportSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const [nextImports, nextExports] = await Promise.all([
      dataApi.listImports(),
      dataApi.listExports(),
    ]);
    setImports(nextImports);
    setExports(nextExports);
  }

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(errorMessage(loadError)));
  }, []);

  useEffect(() => {
    if (!exports.some((record) => record.status === 'pending' || record.status === 'processing')) {
      return;
    }
    const interval = window.setInterval(() => {
      void dataApi
        .listExports()
        .then(setExports)
        .catch((loadError: unknown) => setError(errorMessage(loadError)));
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [exports]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  function chooseFile(file: File | undefined) {
    if (file === undefined) return;
    setFilename(file.name);
    setPreview(null);
    setNotice(null);
    void file
      .text()
      .then(setCsv)
      .catch(() => setError('The CSV file could not be read.'));
  }

  function previewImport(event: FormEvent) {
    event.preventDefault();
    void run('preview', async () => {
      const result = await dataApi.previewClientImport({ csv, filename });
      setPreview(result);
      setNotice(
        result.validRows === 0
          ? 'No rows are ready to import yet.'
          : `${result.validRows} client${result.validRows === 1 ? '' : 's'} ready to import.`,
      );
    });
  }

  function commitImport() {
    void run('import', async () => {
      const result = await dataApi.commitClientImport({ csv, filename });
      setImports((current) => [result, ...current.filter((record) => record.id !== result.id)]);
      setPreview(null);
      setCsv('');
      setFilename('');
      setNotice(
        `${result.importedRows ?? 0} client${result.importedRows === 1 ? '' : 's'} imported.`,
      );
    });
  }

  function requestExport() {
    void run('export', async () => {
      const result = await dataApi.requestExport();
      setExports((current) => [result, ...current]);
      setNotice('Your export is being prepared. We will email you when it is ready.');
    });
  }

  function downloadExport(exportId: string) {
    void run(`download-${exportId}`, async () => {
      const download = await dataApi.downloadExport(exportId);
      window.location.assign(download.url);
    });
  }

  return (
    <AppShell navigation={navigation} productName="Coach App" roleLabel="Coach">
      <PageHeader
        eyebrow="Data portability"
        summary="Bring your client list with you, and take your practice data with you whenever you choose."
        title="Your data, without lock-in"
      />
      {error ? (
        <div className="setup-alert" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="data-notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="data-portability-grid">
        <Card className="data-card" tone="editorial">
          <div className="trv-eyebrow">Bring clients in</div>
          <h2>Import a client CSV</h2>
          <p>
            Preview every row before anything changes. Required columns are name and email; notes
            and tags are optional. Separate tags with semicolons.
          </p>
          <a
            className="trv-button trv-button--line"
            download="traverse-client-import-template.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(CLIENT_IMPORT_TEMPLATE)}`}
          >
            Download CSV template
          </a>
          <form className="data-import-form" onSubmit={previewImport}>
            <Field
              hint={filename === '' ? 'CSV only, up to 1 MB and 1,000 rows.' : filename}
              label="Client CSV"
            >
              <input
                accept=".csv,text/csv"
                className="trv-input"
                onChange={(event) => chooseFile(event.target.files?.[0])}
                type="file"
              />
            </Field>
            <Button disabled={csv === '' || busy !== null} type="submit">
              {busy === 'preview' ? 'Checking file...' : 'Preview import'}
            </Button>
          </form>
          <div className="data-migration-note">
            <strong>Coming from Practice or Profi?</strong>
            <span>
              Use the template for a self-serve import, or ask Traverse for a white-glove mapping
              review before the file is committed.
            </span>
          </div>
        </Card>

        <Card className="data-card">
          <div className="trv-eyebrow">Take everything out</div>
          <h2>Export your practice</h2>
          <p>
            Create a ZIP with a checksum manifest and every domain currently available in Traverse.
            Future video, transcript, invoice, and payment handlers join the same archive as those
            features launch.
          </p>
          <Button disabled={busy !== null} onClick={requestExport} type="button">
            {busy === 'export' ? 'Starting export...' : 'Export everything'}
          </Button>
          <div className="data-trust-list" aria-label="Export safeguards">
            <span>Encrypted private storage</span>
            <span>Download link signed for 15 minutes</span>
            <span>Archive expires after 7 days</span>
          </div>
        </Card>
      </div>

      {preview ? (
        <section className="data-section" aria-labelledby="import-preview-heading">
          <div className="data-section__heading">
            <div>
              <div className="trv-eyebrow">Nothing imported yet</div>
              <h2 id="import-preview-heading">Review {preview.filename}</h2>
            </div>
            <div className="data-badges">
              <Badge tone="accent">{preview.validRows} ready</Badge>
              <Badge tone={preview.rejectedRows > 0 ? 'danger' : 'neutral'}>
                {preview.rejectedRows} need attention
              </Badge>
            </div>
          </div>
          <div className="data-preview-table-wrap">
            <table className="data-preview-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Client</th>
                  <th>Tags</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const rowIssues = preview.issues.filter(
                    (entry) => entry.rowNumber === row.rowNumber,
                  );
                  return (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <strong>{row.name || 'Missing name'}</strong>
                        <span>{row.email || 'Missing email'}</span>
                      </td>
                      <td>{row.tags.join(', ') || 'None'}</td>
                      <td>
                        {row.valid ? (
                          <Badge tone="accent">Ready</Badge>
                        ) : (
                          rowIssues.map((entry) => (
                            <span className="data-row-error" key={`${entry.field}-${entry.code}`}>
                              {entry.message}
                            </span>
                          ))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="data-preview-actions">
            <Button
              disabled={preview.validRows === 0 || busy !== null}
              onClick={commitImport}
              type="button"
            >
              {busy === 'import' ? 'Importing...' : `Import ${preview.validRows} valid clients`}
            </Button>
            <span>Rows with errors stay out of Traverse and remain in the report.</span>
          </div>
        </section>
      ) : null}

      <div className="data-history-grid">
        <section className="data-section" aria-labelledby="import-history-heading">
          <div className="data-section__heading">
            <div>
              <div className="trv-eyebrow">Audit trail</div>
              <h2 id="import-history-heading">Recent imports</h2>
            </div>
          </div>
          {imports.length === 0 ? (
            <p>No client imports yet.</p>
          ) : (
            <div className="data-history-list">
              {imports.map((record) => (
                <div className="data-history-row" key={record.id}>
                  <div>
                    <strong>{record.filename ?? 'Client CSV'}</strong>
                    <span>{dateLabel(record.createdAt)}</span>
                  </div>
                  <div>
                    <Badge tone={record.status === 'ready' ? 'accent' : 'danger'}>
                      {record.status}
                    </Badge>
                    <span>
                      {record.importedRows ?? 0} imported, {record.rejectedRows ?? 0} rejected
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="data-section" aria-labelledby="export-history-heading">
          <div className="data-section__heading">
            <div>
              <div className="trv-eyebrow">Secure delivery</div>
              <h2 id="export-history-heading">Recent exports</h2>
            </div>
          </div>
          {exports.length === 0 ? (
            <p>No practice exports yet.</p>
          ) : (
            <div className="data-history-list">
              {exports.map((record) => (
                <div className="data-history-row" key={record.id}>
                  <div>
                    <strong>Practice export</strong>
                    <span>
                      {dateLabel(record.createdAt)} {byteLabel(record.archiveSizeBytes)}
                    </span>
                  </div>
                  <div>
                    <Badge
                      tone={
                        record.status === 'ready'
                          ? 'accent'
                          : record.status === 'failed' || record.status === 'expired'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {record.status}
                    </Badge>
                    {record.status === 'ready' ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => downloadExport(record.id)}
                        type="button"
                        variant="line"
                      >
                        {busy === `download-${record.id}` ? 'Signing...' : 'Download ZIP'}
                      </Button>
                    ) : (
                      <span>
                        {record.status === 'processing' || record.status === 'pending'
                          ? 'Preparing archive...'
                          : record.status === 'expired'
                            ? 'Request a new export.'
                            : 'Try the export again.'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export function App() {
  const { pathname } = window.location;
  const contractMatch = pathname.match(/^\/contracts\/([^/]+)\/sign$/);
  if (contractMatch?.[1] !== undefined) {
    return <CoachContractSignaturePage contractId={decodeURIComponent(contractMatch[1])} />;
  }

  if (pathname === '/clients/new') return <InviteClientPage />;

  const relationshipMatch = pathname.match(/^\/clients\/([^/]+)$/);
  if (relationshipMatch?.[1] !== undefined) {
    return <CoachWorkspacePage relationshipId={decodeURIComponent(relationshipMatch[1])} />;
  }

  if (pathname === '/clients') return <LiveCoachLoop focus="clients" />;
  if (pathname === '/calendar') return <LiveCoachLoop focus="calendar" />;
  if (pathname === '/groups') return <LiveCoachLoop focus="groups" />;
  if (isCoachDashboardPath(pathname)) return <LiveCoachLoop focus="dashboard" />;
  if (pathname === '/settings/data') return <DataPortabilityPage />;
  if (pathname === '/logout') return <CoachSignOut />;
  if (pathname === '/signup') return <CoachSignup />;
  if (pathname === '/verify-email') return <CoachEmailVerification />;

  return <CoachSetupApp />;
}
