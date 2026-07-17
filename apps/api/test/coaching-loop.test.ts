import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ClientOnboardingActor,
  CoachOnboardingActor,
} from '../src/client-onboarding.service.js';
import type { AppointmentSnapshot, CoachingLoopStore } from '../src/coaching-loop.service.js';
import { CoachingLoopService } from '../src/coaching-loop.service.js';

const coach: CoachOnboardingActor = {
  coachId: '22222222-2222-4222-8222-222222222222',
  practiceRole: 'owner',
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '33333333-3333-4333-8333-333333333333',
};

const client: ClientOnboardingActor = {
  clientId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
};

const relationshipId = '66666666-6666-4666-8666-666666666666';
const appointmentId = '77777777-7777-4777-8777-777777777777';
const appointmentTypeId = '88888888-8888-4888-8888-888888888888';
const holdId = '99999999-9999-4999-8999-999999999999';

function memoryStore(overrides: Partial<CoachingLoopStore>): CoachingLoopStore {
  return new Proxy(overrides, {
    get(target, property): unknown {
      if (property in target) return target[property as keyof CoachingLoopStore];
      return () => Promise.reject(new Error(`Unexpected store call: ${String(property)}`));
    },
  }) as CoachingLoopStore;
}

function appointment(overrides: Partial<AppointmentSnapshot> = {}): AppointmentSnapshot {
  return {
    appointmentTypeId,
    bookedByClient: false,
    calendarUrl: `/api/client/appointments/${appointmentId}/ical`,
    endsAt: new Date('2026-08-12T16:00:00.000Z'),
    id: appointmentId,
    meetingLink: 'https://meet.example.test/session',
    notes: 'Bring focus',
    startsAt: new Date('2026-08-12T15:00:00.000Z'),
    status: 'scheduled',
    target: { id: relationshipId, name: 'Client A', type: 'client' },
    timezone: 'America/Toronto',
    title: 'Coaching session',
    ...overrides,
  };
}

test('TRA-41 validates appointment subjects, ranges, time zones, and meeting links', async () => {
  let calls = 0;
  const service = new CoachingLoopService(
    memoryStore({
      async createAppointment() {
        calls += 1;
        return appointment();
      },
    }),
  );

  const valid = {
    appointmentTypeId,
    endsAt: '2026-08-12T16:00:00.000Z',
    groupId: null,
    meetingLink: 'https://meet.example.test/session',
    notes: 'Bring focus',
    relationshipId,
    startsAt: '2026-08-12T15:00:00.000Z',
    timezone: 'America/Toronto',
    title: 'Coaching session',
  };

  await service.createAppointment(coach, valid);
  assert.equal(calls, 1);
  await assert.rejects(
    service.createAppointment(coach, { ...valid, groupId: appointmentId }),
    /exactly one client relationship or group/,
  );
  await assert.rejects(
    service.createAppointment(coach, { ...valid, endsAt: valid.startsAt }),
    /end must be after start/,
  );
  await assert.rejects(
    service.createAppointment(coach, { ...valid, timezone: 'Mars/Olympus' }),
    /valid IANA time zone/,
  );
  await assert.rejects(
    service.createAppointment(coach, { ...valid, meetingLink: 'http://meet.example.test' }),
    /valid HTTPS URL/,
  );
  assert.equal(calls, 1);
});

test('TRA-41 translates PostgreSQL overlap constraints into an actionable conflict', async () => {
  const overlap = Object.assign(new Error('exclusion constraint'), { code: '23P01' });
  const service = new CoachingLoopService(
    memoryStore({
      createAppointment: () => Promise.reject(overlap),
      updateAppointment: () => Promise.reject(overlap),
    }),
  );
  const input = {
    appointmentTypeId,
    endsAt: '2026-08-12T16:00:00.000Z',
    groupId: null,
    meetingLink: null,
    notes: null,
    relationshipId,
    startsAt: '2026-08-12T15:00:00.000Z',
    timezone: 'UTC',
    title: 'Coaching session',
  };

  await assert.rejects(service.createAppointment(coach, input), /overlaps another scheduled/);
  await assert.rejects(
    service.updateAppointment(coach, appointmentId, {
      action: 'reschedule',
      endsAt: input.endsAt,
      meetingLink: null,
      notes: null,
      startsAt: input.startsAt,
      timezone: 'UTC',
    }),
    /overlaps another scheduled/,
  );
});

test('TRA-41 derives client-booked titles from the appointment type', async () => {
  let observed: Parameters<CoachingLoopStore['confirmClientBooking']>[1] | undefined;
  const service = new CoachingLoopService(
    memoryStore({
      async confirmClientBooking(_actor, input) {
        observed = input;
        return appointment({ bookedByClient: true, status: 'booked' });
      },
    }),
  );

  await service.confirmClientBooking(client, holdId, {
    appointmentTypeId,
    relationshipId,
    title: 'Untrusted replacement title',
  });
  assert.deepEqual(observed, { appointmentTypeId, holdId, relationshipId });
});

test('TRA-41 rejects oversized encrypted relationship notes instead of truncating them', async () => {
  const service = new CoachingLoopService(memoryStore({}));
  await assert.rejects(
    service.saveRelationshipNotes(coach, relationshipId, { notes: 'x'.repeat(20_001) }),
    /20000 characters or fewer/,
  );
});

test('TRA-41 emits an escaped cancellation-aware iCalendar event', async () => {
  const service = new CoachingLoopService(
    memoryStore({
      async getClientAppointment() {
        return appointment({
          notes: 'Line one\nLine two',
          status: 'canceled',
          title: 'Focus, clarity; action',
        });
      },
    }),
  );

  const calendar = await service.clientCalendar(client, appointmentId);
  assert.match(calendar, /BEGIN:VCALENDAR\r\nVERSION:2\.0/);
  assert.match(calendar, /SUMMARY:Focus\\, clarity\\; action/);
  assert.match(calendar, /DESCRIPTION:Line one\\nLine two/);
  assert.match(calendar, /STATUS:CANCELLED/);
  assert.match(calendar, new RegExp(`UID:${appointmentId}@traversecoaching\\.com`));
});
