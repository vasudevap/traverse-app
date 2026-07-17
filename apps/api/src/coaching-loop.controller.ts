import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guards.js';
import {
  ClientCsrfGuard,
  ClientSessionGuard,
  CoachCsrfGuard,
  CoachSessionGuard,
} from './auth.guards.js';
import type { ClientOnboardingActor, CoachOnboardingActor } from './client-onboarding.service.js';
import { CoachingLoopService } from './coaching-loop.service.js';

interface DownloadResponse {
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

function coachActor(request: AuthenticatedRequest): CoachOnboardingActor {
  const session = request.authSession;
  if (
    session === undefined ||
    session.role !== 'coach' ||
    session.status !== 'active' ||
    session.tenantId === null ||
    session.coachId === null ||
    (session.practiceRole !== 'owner' && session.practiceRole !== 'coach')
  ) {
    throw new UnauthorizedException('An active coach session is required.');
  }
  return {
    coachId: session.coachId,
    practiceRole: session.practiceRole,
    tenantId: session.tenantId,
    userId: session.userId,
  };
}

function clientActor(request: AuthenticatedRequest): ClientOnboardingActor {
  const session = request.authSession;
  if (
    session === undefined ||
    session.role !== 'client' ||
    session.status !== 'active' ||
    session.clientId === null
  ) {
    throw new UnauthorizedException('An active client session is required.');
  }
  return { clientId: session.clientId, userId: session.userId };
}

function sendCalendar(response: DownloadResponse, appointmentId: string, calendar: string): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Content-Disposition', `attachment; filename="traverse-${appointmentId}.ics"`);
  response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  response.send(calendar);
}

@Controller('coach')
@UseGuards(CoachSessionGuard)
export class CoachCoachingLoopController {
  constructor(
    @Inject(CoachingLoopService)
    private readonly loop: CoachingLoopService,
  ) {}

  @Get('loop/dashboard')
  dashboard(@Req() request: AuthenticatedRequest) {
    return this.loop.getCoachDashboard(coachActor(request));
  }

  @Get('relationships/:relationshipId/workspace')
  workspace(@Param('relationshipId') relationshipId: string, @Req() request: AuthenticatedRequest) {
    return this.loop.getCoachWorkspace(coachActor(request), relationshipId);
  }

  @Patch('relationships/:relationshipId/notes')
  @UseGuards(CoachCsrfGuard)
  notes(
    @Param('relationshipId') relationshipId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.saveRelationshipNotes(coachActor(request), relationshipId, body);
  }

  @Post('appointment-types')
  @UseGuards(CoachCsrfGuard)
  createAppointmentType(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createAppointmentType(coachActor(request), body);
  }

  @Patch('appointment-types/:appointmentTypeId')
  @UseGuards(CoachCsrfGuard)
  updateAppointmentType(
    @Param('appointmentTypeId') appointmentTypeId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.updateAppointmentType(coachActor(request), appointmentTypeId, body);
  }

  @Get('availability')
  availability(@Req() request: AuthenticatedRequest) {
    return this.loop.listAvailability(coachActor(request));
  }

  @Post('availability')
  @UseGuards(CoachCsrfGuard)
  createAvailability(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createAvailability(coachActor(request), body);
  }

  @Delete('availability/:availabilityId')
  @UseGuards(CoachCsrfGuard)
  removeAvailability(
    @Param('availabilityId') availabilityId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.loop.removeAvailability(coachActor(request), availabilityId);
  }

  @Post('appointments')
  @UseGuards(CoachCsrfGuard)
  createAppointment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createAppointment(coachActor(request), body);
  }

  @Patch('appointments/:appointmentId')
  @UseGuards(CoachCsrfGuard)
  updateAppointment(
    @Param('appointmentId') appointmentId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.updateAppointment(coachActor(request), appointmentId, body);
  }

  @Get('appointments/:appointmentId/ical')
  async coachCalendar(
    @Param('appointmentId') appointmentId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: DownloadResponse,
  ) {
    sendCalendar(
      response,
      appointmentId,
      await this.loop.coachCalendar(coachActor(request), appointmentId),
    );
  }

  @Post('tasks')
  @UseGuards(CoachCsrfGuard)
  createTask(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createTask(coachActor(request), body);
  }

  @Patch('tasks/:taskId')
  @UseGuards(CoachCsrfGuard)
  updateTask(
    @Param('taskId') taskId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.updateTask(coachActor(request), taskId, body);
  }

  @Post('groups')
  @UseGuards(CoachCsrfGuard)
  createGroup(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createGroup(coachActor(request), body);
  }

  @Patch('groups/:groupId')
  @UseGuards(CoachCsrfGuard)
  updateGroup(
    @Param('groupId') groupId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.updateGroup(coachActor(request), groupId, body);
  }

  @Post('groups/:groupId/members/:clientId')
  @UseGuards(CoachCsrfGuard)
  addGroupMember(
    @Param('groupId') groupId: string,
    @Param('clientId') clientId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.loop.addGroupMember(coachActor(request), groupId, clientId);
  }

  @Delete('groups/:groupId/members/:clientId')
  @UseGuards(CoachCsrfGuard)
  removeGroupMember(
    @Param('groupId') groupId: string,
    @Param('clientId') clientId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.loop.removeGroupMember(coachActor(request), groupId, clientId);
  }
}

@Controller('client')
@UseGuards(ClientSessionGuard)
export class ClientCoachingLoopController {
  constructor(
    @Inject(CoachingLoopService)
    private readonly loop: CoachingLoopService,
  ) {}

  @Get('home')
  home(@Req() request: AuthenticatedRequest) {
    return this.loop.getClientHome(clientActor(request));
  }

  @Post('booking/holds')
  @UseGuards(ClientCsrfGuard)
  hold(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.loop.createClientBookingHold(clientActor(request), body);
  }

  @Post('booking/holds/:holdId/confirm')
  @UseGuards(ClientCsrfGuard)
  confirm(
    @Param('holdId') holdId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.loop.confirmClientBooking(clientActor(request), holdId, body);
  }

  @Delete('booking/holds/:holdId')
  @UseGuards(ClientCsrfGuard)
  release(@Param('holdId') holdId: string, @Req() request: AuthenticatedRequest) {
    return this.loop.releaseClientBookingHold(clientActor(request), holdId);
  }

  @Post('tasks/:taskId/complete')
  @UseGuards(ClientCsrfGuard)
  completeTask(@Param('taskId') taskId: string, @Req() request: AuthenticatedRequest) {
    return this.loop.completeClientTask(clientActor(request), taskId);
  }

  @Get('appointments/:appointmentId/ical')
  async clientCalendar(
    @Param('appointmentId') appointmentId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: DownloadResponse,
  ) {
    sendCalendar(
      response,
      appointmentId,
      await this.loop.clientCalendar(clientActor(request), appointmentId),
    );
  }
}
