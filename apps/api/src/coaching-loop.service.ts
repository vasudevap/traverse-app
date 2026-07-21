import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ClientOnboardingActor, CoachOnboardingActor } from './client-onboarding.service.js';

export const COACHING_LOOP_STORE = Symbol('COACHING_LOOP_STORE');

export interface AppointmentTypeSnapshot {
  active: boolean;
  currency: string | null;
  defaultDurationMinutes: number;
  id: string;
  name: string;
  notes: string | null;
  priceAmount: number | null;
  selfBookable: boolean;
}

export interface AppointmentSnapshot {
  appointmentTypeId: string | null;
  bookedByClient: boolean;
  calendarUrl: string;
  endsAt: Date;
  id: string;
  meetingLink: string | null;
  notes: string | null;
  startsAt: Date;
  status: 'booked' | 'canceled' | 'completed' | 'scheduled';
  target: { id: string; name: string; type: 'client' | 'group' };
  timezone: string;
  title: string;
}

export interface TaskSnapshot {
  clientName: string;
  completedAt: Date | null;
  description: string | null;
  dueAt: Date | null;
  id: string;
  relationshipId: string;
  status: 'assigned' | 'canceled' | 'completed';
  title: string;
}

export interface GroupSnapshot {
  archivedAt: Date | null;
  description: string | null;
  id: string;
  members: Array<{ clientId: string; name: string }>;
  name: string;
}

export interface AvailabilitySnapshot {
  active: boolean;
  endsAt: Date | null;
  id: string;
  localEndsAt: string | null;
  localStartsAt: string | null;
  startsAt: Date | null;
  timezone: string;
  type: 'slot' | 'weekly';
  weekday: number | null;
}

export type RelationshipHealth =
  | 'active'
  | 'awaiting_first_touch'
  | 'invited'
  | 'inactive_risk'
  | 'newly_active'
  | 'scheduled'
  | 'task_pending';

export interface CoachRelationshipSummary {
  client: { id: string; email: string; name: string };
  health: RelationshipHealth;
  id: string;
  inviteExpiresAt: Date | null;
  lastActivityAt: Date;
  nextAppointment: AppointmentSnapshot | null;
  openTaskCount: number;
}

export interface CoachDashboardSnapshot {
  appointmentTypes: AppointmentTypeSnapshot[];
  coachName: string;
  groups: GroupSnapshot[];
  relationships: CoachRelationshipSummary[];
  timezone: string;
  upcomingAppointments: AppointmentSnapshot[];
}

export interface CoachRelationshipWorkspace {
  appointments: AppointmentSnapshot[];
  client: { email: string; id: string; name: string; phone: string | null };
  health: RelationshipHealth;
  id: string;
  notes: string;
  tasks: TaskSnapshot[];
}

export interface ClientRelationshipHome {
  appointmentTypes: AppointmentTypeSnapshot[];
  availableSlots: AvailabilitySnapshot[];
  coach: { name: string; practiceName: string };
  id: string;
}

export interface ClientHomeSnapshot {
  appointments: AppointmentSnapshot[];
  nextAction:
    | { appointmentId: string; kind: 'appointment'; startsAt: Date; title: string }
    | { kind: 'task'; taskId: string; title: string }
    | { kind: 'waiting'; message: string };
  relationships: ClientRelationshipHome[];
  tasks: TaskSnapshot[];
}

export interface BookingHoldSnapshot {
  endsAt: Date;
  expiresAt: Date;
  id: string;
  relationshipId: string;
  startsAt: Date;
}

export interface CoachingLoopStore {
  addGroupMember(
    actor: CoachOnboardingActor,
    groupId: string,
    clientId: string,
  ): Promise<GroupSnapshot | undefined>;
  completeClientTask(
    actor: ClientOnboardingActor,
    taskId: string,
  ): Promise<TaskSnapshot | undefined>;
  confirmClientBooking(
    actor: ClientOnboardingActor,
    input: { appointmentTypeId: string; holdId: string; relationshipId: string },
  ): Promise<AppointmentSnapshot | undefined>;
  createAppointment(
    actor: CoachOnboardingActor,
    input: {
      appointmentTypeId: string | null;
      endsAt: Date;
      groupId: string | null;
      meetingLink: string | null;
      notes: string | null;
      relationshipId: string | null;
      startsAt: Date;
      timezone: string;
      title: string;
    },
  ): Promise<AppointmentSnapshot | undefined>;
  createAppointmentType(
    actor: CoachOnboardingActor,
    input: Omit<AppointmentTypeSnapshot, 'active' | 'id'>,
  ): Promise<AppointmentTypeSnapshot>;
  createAvailability(
    actor: CoachOnboardingActor,
    input:
      | { endsAt: Date; startsAt: Date; timezone: string; type: 'slot' }
      | {
          localEndsAt: string;
          localStartsAt: string;
          timezone: string;
          type: 'weekly';
          weekday: number;
        },
  ): Promise<AvailabilitySnapshot>;
  createClientBookingHold(
    actor: ClientOnboardingActor,
    input: { availabilityId: string; relationshipId: string },
  ): Promise<BookingHoldSnapshot | undefined>;
  createGroup(
    actor: CoachOnboardingActor,
    input: { description: string | null; name: string },
  ): Promise<GroupSnapshot>;
  createTask(
    actor: CoachOnboardingActor,
    input: {
      description: string | null;
      dueAt: Date | null;
      relationshipId: string;
      title: string;
    },
  ): Promise<TaskSnapshot | undefined>;
  getClientHome(actor: ClientOnboardingActor): Promise<ClientHomeSnapshot>;
  getCoachDashboard(actor: CoachOnboardingActor): Promise<CoachDashboardSnapshot>;
  getCoachWorkspace(
    actor: CoachOnboardingActor,
    relationshipId: string,
  ): Promise<CoachRelationshipWorkspace | undefined>;
  getClientAppointment(
    actor: ClientOnboardingActor,
    appointmentId: string,
  ): Promise<AppointmentSnapshot | undefined>;
  listAvailability(actor: CoachOnboardingActor): Promise<AvailabilitySnapshot[]>;
  releaseClientBookingHold(actor: ClientOnboardingActor, holdId: string): Promise<boolean>;
  removeAvailability(actor: CoachOnboardingActor, availabilityId: string): Promise<boolean>;
  removeGroupMember(
    actor: CoachOnboardingActor,
    groupId: string,
    clientId: string,
  ): Promise<GroupSnapshot | undefined>;
  saveRelationshipNotes(
    actor: CoachOnboardingActor,
    relationshipId: string,
    notes: string,
  ): Promise<CoachRelationshipWorkspace | undefined>;
  updateAppointment(
    actor: CoachOnboardingActor,
    appointmentId: string,
    input:
      | { action: 'cancel' | 'complete' }
      | {
          action: 'reschedule';
          endsAt: Date;
          meetingLink: string | null;
          notes: string | null;
          startsAt: Date;
          timezone: string;
        },
  ): Promise<AppointmentSnapshot | undefined>;
  updateAppointmentType(
    actor: CoachOnboardingActor,
    appointmentTypeId: string,
    input: Partial<Omit<AppointmentTypeSnapshot, 'id'>>,
  ): Promise<AppointmentTypeSnapshot | undefined>;
  updateGroup(
    actor: CoachOnboardingActor,
    groupId: string,
    input: { archived: boolean; description: string | null; name: string },
  ): Promise<GroupSnapshot | undefined>;
  updateTask(
    actor: CoachOnboardingActor,
    taskId: string,
    input: { action: 'cancel' | 'reopen' },
  ): Promise<TaskSnapshot | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('Request body must be an object.');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${label} is required.`);
  }
  const result = value.trim();
  if (result.length > max) {
    throw new BadRequestException(`${label} must be ${max} characters or fewer.`);
  }
  return result;
}

function optionalString(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function idValue(value: unknown, label: string): string {
  const id = requiredString(value, label, 36);
  if (!UUID.test(id)) throw new BadRequestException(`${label} must be a valid id.`);
  return id;
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return idValue(value, label);
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new BadRequestException(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${label} must be a boolean.`);
  return value;
}

function dateValue(value: unknown, label: string): Date {
  if (typeof value !== 'string') throw new BadRequestException(`${label} must be an ISO date.`);
  const result = new Date(value);
  if (Number.isNaN(result.getTime()))
    throw new BadRequestException(`${label} must be an ISO date.`);
  return result;
}

function optionalDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return dateValue(value, label);
}

function timezoneValue(value: unknown): string {
  const timezone = requiredString(value, 'timezone', 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA time zone.');
  }
  return timezone;
}

function timeValue(value: unknown, label: string): string {
  const time = requiredString(value, label, 8);
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    throw new BadRequestException(`${label} must be a 24-hour time.`);
  }
  return time;
}

function appointmentRange(input: Record<string, unknown>) {
  const startsAt = dateValue(input.startsAt, 'startsAt');
  const endsAt = dateValue(input.endsAt, 'endsAt');
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 8 * 60 * 60 * 1000) {
    throw new BadRequestException('Appointment end must be after start and within 8 hours.');
  }
  return { endsAt, startsAt };
}

function meetingLinkValue(value: unknown): string | null {
  const link = optionalString(value, 'meetingLink', 2_000);
  if (link === null) return null;
  try {
    if (new URL(link).protocol !== 'https:') throw new Error('protocol');
  } catch {
    throw new BadRequestException('meetingLink must be a valid HTTPS URL.');
  }
  return link;
}

function currencyValue(value: unknown, priceAmount: number | null): string | null {
  if (priceAmount === null) return null;
  const currency = requiredString(value, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException('currency must be a three-letter code.');
  }
  return currency;
}

function calendarEscape(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

function calendarDate(value: Date): string {
  return value
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function appointmentIcal(appointment: AppointmentSnapshot): string {
  const description = [appointment.notes, appointment.meetingLink].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Traverse//Coaching Session//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@traversecoaching.com`,
    `DTSTAMP:${calendarDate(new Date())}`,
    `DTSTART:${calendarDate(appointment.startsAt)}`,
    `DTEND:${calendarDate(appointment.endsAt)}`,
    `SUMMARY:${calendarEscape(appointment.title)}`,
    `DESCRIPTION:${calendarEscape(description)}`,
    appointment.meetingLink === null ? null : `URL:${calendarEscape(appointment.meetingLink)}`,
    `STATUS:${appointment.status === 'canceled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\r\n');
}

function isSchedulingConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '23P01' || code === '23505';
}

@Injectable()
export class CoachingLoopService {
  constructor(@Inject(COACHING_LOOP_STORE) private readonly store: CoachingLoopStore) {}

  getCoachDashboard(actor: CoachOnboardingActor) {
    return this.store.getCoachDashboard(actor);
  }

  async getCoachWorkspace(actor: CoachOnboardingActor, relationshipId: string) {
    const workspace = await this.store.getCoachWorkspace(
      actor,
      idValue(relationshipId, 'relationshipId'),
    );
    if (workspace === undefined)
      throw new NotFoundException('Active coaching relationship was not found.');
    return workspace;
  }

  async saveRelationshipNotes(actor: CoachOnboardingActor, relationshipId: string, body: unknown) {
    const input = objectValue(body);
    if (typeof input.notes !== 'string') {
      throw new BadRequestException('notes must be a string.');
    }
    if (input.notes.trim().length > 20_000) {
      throw new BadRequestException('notes must be 20000 characters or fewer.');
    }
    const workspace = await this.store.saveRelationshipNotes(
      actor,
      idValue(relationshipId, 'relationshipId'),
      input.notes.trim(),
    );
    if (workspace === undefined)
      throw new NotFoundException('Active coaching relationship was not found.');
    return workspace;
  }

  createAppointmentType(actor: CoachOnboardingActor, body: unknown) {
    const input = objectValue(body);
    const priceAmount =
      input.priceAmount === undefined || input.priceAmount === null
        ? null
        : integerValue(input.priceAmount, 'priceAmount', 0, 100_000_000);
    return this.store.createAppointmentType(actor, {
      currency: currencyValue(input.currency, priceAmount),
      defaultDurationMinutes: integerValue(
        input.defaultDurationMinutes,
        'defaultDurationMinutes',
        5,
        480,
      ),
      name: requiredString(input.name, 'name', 120),
      notes: optionalString(input.notes, 'notes', 2_000),
      priceAmount,
      selfBookable:
        input.selfBookable === undefined ? false : booleanValue(input.selfBookable, 'selfBookable'),
    });
  }

  async updateAppointmentType(
    actor: CoachOnboardingActor,
    appointmentTypeId: string,
    body: unknown,
  ) {
    const input = objectValue(body);
    const patch: Partial<Omit<AppointmentTypeSnapshot, 'id'>> = {};
    if ('active' in input) patch.active = booleanValue(input.active, 'active');
    if ('name' in input) patch.name = requiredString(input.name, 'name', 120);
    if ('defaultDurationMinutes' in input) {
      patch.defaultDurationMinutes = integerValue(
        input.defaultDurationMinutes,
        'defaultDurationMinutes',
        5,
        480,
      );
    }
    if ('notes' in input) patch.notes = optionalString(input.notes, 'notes', 2_000);
    if ('selfBookable' in input)
      patch.selfBookable = booleanValue(input.selfBookable, 'selfBookable');
    if ('priceAmount' in input || 'currency' in input) {
      const priceAmount =
        input.priceAmount === undefined || input.priceAmount === null
          ? null
          : integerValue(input.priceAmount, 'priceAmount', 0, 100_000_000);
      patch.priceAmount = priceAmount;
      patch.currency = currencyValue(input.currency, priceAmount);
    }
    const result = await this.store.updateAppointmentType(
      actor,
      idValue(appointmentTypeId, 'appointmentTypeId'),
      patch,
    );
    if (result === undefined) throw new NotFoundException('Appointment type was not found.');
    return result;
  }

  listAvailability(actor: CoachOnboardingActor) {
    return this.store.listAvailability(actor);
  }

  createAvailability(actor: CoachOnboardingActor, body: unknown) {
    const input = objectValue(body);
    const type = requiredString(input.type, 'type', 16);
    const timezone = timezoneValue(input.timezone);
    if (type === 'slot') {
      const range = appointmentRange(input);
      if (range.startsAt <= new Date())
        throw new BadRequestException('Proposed slots must be in the future.');
      return this.store.createAvailability(actor, { ...range, timezone, type });
    }
    if (type === 'weekly') {
      return this.store.createAvailability(actor, {
        localEndsAt: timeValue(input.localEndsAt, 'localEndsAt'),
        localStartsAt: timeValue(input.localStartsAt, 'localStartsAt'),
        timezone,
        type,
        weekday: integerValue(input.weekday, 'weekday', 0, 6),
      });
    }
    throw new BadRequestException('type must be slot or weekly.');
  }

  async removeAvailability(actor: CoachOnboardingActor, availabilityId: string) {
    if (!(await this.store.removeAvailability(actor, idValue(availabilityId, 'availabilityId')))) {
      throw new NotFoundException('Availability window was not found.');
    }
    return { removed: true };
  }

  async createAppointment(actor: CoachOnboardingActor, body: unknown) {
    const input = objectValue(body);
    const relationshipId = optionalId(input.relationshipId, 'relationshipId');
    const groupId = optionalId(input.groupId, 'groupId');
    if ((relationshipId === null) === (groupId === null)) {
      throw new BadRequestException('Choose exactly one client relationship or group.');
    }
    try {
      const result = await this.store.createAppointment(actor, {
        ...appointmentRange(input),
        appointmentTypeId: optionalId(input.appointmentTypeId, 'appointmentTypeId'),
        groupId,
        meetingLink: meetingLinkValue(input.meetingLink),
        notes: optionalString(input.notes, 'notes', 4_000),
        relationshipId,
        timezone: timezoneValue(input.timezone),
        title: requiredString(input.title, 'title', 200),
      });
      if (result === undefined) {
        throw new NotFoundException('Active client, group, or appointment type was not found.');
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (isSchedulingConflict(error)) {
        throw new ConflictException('That time overlaps another scheduled appointment.');
      }
      throw error;
    }
  }

  async updateAppointment(actor: CoachOnboardingActor, appointmentId: string, body: unknown) {
    const input = objectValue(body);
    const action = requiredString(input.action, 'action', 20);
    let result: AppointmentSnapshot | undefined;
    if (action === 'cancel' || action === 'complete') {
      result = await this.store.updateAppointment(actor, idValue(appointmentId, 'appointmentId'), {
        action,
      });
    } else if (action === 'reschedule') {
      try {
        result = await this.store.updateAppointment(
          actor,
          idValue(appointmentId, 'appointmentId'),
          {
            action,
            ...appointmentRange(input),
            meetingLink: meetingLinkValue(input.meetingLink),
            notes: optionalString(input.notes, 'notes', 4_000),
            timezone: timezoneValue(input.timezone),
          },
        );
      } catch (error) {
        if (isSchedulingConflict(error)) {
          throw new ConflictException('That time overlaps another scheduled appointment.');
        }
        throw error;
      }
    } else {
      throw new BadRequestException('action must be reschedule, cancel, or complete.');
    }
    if (result === undefined) throw new NotFoundException('Appointment was not found.');
    return result;
  }

  async createTask(actor: CoachOnboardingActor, body: unknown) {
    const input = objectValue(body);
    const task = await this.store.createTask(actor, {
      description: optionalString(input.description, 'description', 4_000),
      dueAt: optionalDate(input.dueAt, 'dueAt'),
      relationshipId: idValue(input.relationshipId, 'relationshipId'),
      title: requiredString(input.title, 'title', 200),
    });
    if (task === undefined)
      throw new NotFoundException('Active coaching relationship was not found.');
    return task;
  }

  async updateTask(actor: CoachOnboardingActor, taskId: string, body: unknown) {
    const input = objectValue(body);
    const action = requiredString(input.action, 'action', 20);
    if (action !== 'cancel' && action !== 'reopen') {
      throw new BadRequestException('action must be cancel or reopen.');
    }
    const result = await this.store.updateTask(actor, idValue(taskId, 'taskId'), { action });
    if (result === undefined) throw new NotFoundException('Task was not found.');
    return result;
  }

  createGroup(actor: CoachOnboardingActor, body: unknown) {
    const input = objectValue(body);
    return this.store.createGroup(actor, {
      description: optionalString(input.description, 'description', 2_000),
      name: requiredString(input.name, 'name', 120),
    });
  }

  async updateGroup(actor: CoachOnboardingActor, groupId: string, body: unknown) {
    const input = objectValue(body);
    const result = await this.store.updateGroup(actor, idValue(groupId, 'groupId'), {
      archived: input.archived === undefined ? false : booleanValue(input.archived, 'archived'),
      description: optionalString(input.description, 'description', 2_000),
      name: requiredString(input.name, 'name', 120),
    });
    if (result === undefined) throw new NotFoundException('Group was not found.');
    return result;
  }

  async addGroupMember(actor: CoachOnboardingActor, groupId: string, clientId: string) {
    const result = await this.store.addGroupMember(
      actor,
      idValue(groupId, 'groupId'),
      idValue(clientId, 'clientId'),
    );
    if (result === undefined) throw new NotFoundException('Group or active client was not found.');
    return result;
  }

  async removeGroupMember(actor: CoachOnboardingActor, groupId: string, clientId: string) {
    const result = await this.store.removeGroupMember(
      actor,
      idValue(groupId, 'groupId'),
      idValue(clientId, 'clientId'),
    );
    if (result === undefined) throw new NotFoundException('Group membership was not found.');
    return result;
  }

  getClientHome(actor: ClientOnboardingActor) {
    return this.store.getClientHome(actor);
  }

  async createClientBookingHold(actor: ClientOnboardingActor, body: unknown) {
    const input = objectValue(body);
    try {
      const result = await this.store.createClientBookingHold(actor, {
        availabilityId: idValue(input.availabilityId, 'availabilityId'),
        relationshipId: idValue(input.relationshipId, 'relationshipId'),
      });
      if (result === undefined) throw new NotFoundException('Available slot was not found.');
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ConflictException('That time is no longer available. Choose another slot.');
    }
  }

  async confirmClientBooking(actor: ClientOnboardingActor, holdId: string, body: unknown) {
    const input = objectValue(body);
    try {
      const result = await this.store.confirmClientBooking(actor, {
        appointmentTypeId: idValue(input.appointmentTypeId, 'appointmentTypeId'),
        holdId: idValue(holdId, 'holdId'),
        relationshipId: idValue(input.relationshipId, 'relationshipId'),
      });
      if (result === undefined) throw new NotFoundException('Active booking hold was not found.');
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ConflictException('That booking could not be completed. Refresh and try again.');
    }
  }

  async releaseClientBookingHold(actor: ClientOnboardingActor, holdId: string) {
    if (!(await this.store.releaseClientBookingHold(actor, idValue(holdId, 'holdId')))) {
      throw new NotFoundException('Active booking hold was not found.');
    }
    return { released: true };
  }

  async completeClientTask(actor: ClientOnboardingActor, taskId: string) {
    const task = await this.store.completeClientTask(actor, idValue(taskId, 'taskId'));
    if (task === undefined) throw new NotFoundException('Assigned task was not found.');
    return task;
  }

  async coachCalendar(actor: CoachOnboardingActor, appointmentId: string) {
    const dashboard = await this.store.getCoachDashboard(actor);
    const appointment = dashboard.upcomingAppointments.find(
      (item) => item.id === idValue(appointmentId, 'appointmentId'),
    );
    if (appointment === undefined)
      throw new NotFoundException('Upcoming appointment was not found.');
    return appointmentIcal(appointment);
  }

  async clientCalendar(actor: ClientOnboardingActor, appointmentId: string) {
    const appointment = await this.store.getClientAppointment(
      actor,
      idValue(appointmentId, 'appointmentId'),
    );
    if (appointment === undefined) throw new NotFoundException('Appointment was not found.');
    return appointmentIcal(appointment);
  }
}
