import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guards.js';
import { CoachCsrfGuard, CoachSessionGuard } from './auth.guards.js';
import type { CoachOnboardingActor } from './client-onboarding.service.js';
import { DataPortabilityService } from './data-portability.service.js';

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

@Controller('coach')
@UseGuards(CoachSessionGuard)
export class CoachDataPortabilityController {
  constructor(private readonly portability: DataPortabilityService) {}

  @Post('imports/clients/preview')
  @UseGuards(CoachCsrfGuard)
  previewClientImport(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.portability.previewClientImport(coachActor(request), body);
  }

  @Post('imports/clients')
  @UseGuards(CoachCsrfGuard)
  importClients(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.portability.importClients(coachActor(request), body);
  }

  @Get('imports')
  listImports(@Req() request: AuthenticatedRequest) {
    return this.portability.listImports(coachActor(request));
  }

  @Post('exports')
  @UseGuards(CoachCsrfGuard)
  requestExport(@Req() request: AuthenticatedRequest) {
    return this.portability.requestExport(coachActor(request));
  }

  @Get('exports')
  listExports(@Req() request: AuthenticatedRequest) {
    return this.portability.listExports(coachActor(request));
  }

  @Get('exports/:exportId/download')
  downloadExport(@Param('exportId') exportId: string, @Req() request: AuthenticatedRequest) {
    return this.portability.downloadExport(coachActor(request), exportId);
  }
}
