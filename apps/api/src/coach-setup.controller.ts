import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedSessionGuard,
  type AuthenticatedRequest,
  OriginCsrfGuard,
} from './auth.guards.js';
import { type CoachSetupActor, CoachSetupService } from './coach-setup.service.js';

function setupActor(surface: string, request: AuthenticatedRequest): CoachSetupActor {
  if (surface !== 'coach') throw new NotFoundException();
  const session = request.authSession;
  if (
    session === undefined ||
    session.role !== 'coach' ||
    session.status !== 'active' ||
    session.tenantId === null ||
    session.coachId === null ||
    session.practiceRole !== 'owner'
  ) {
    throw new UnauthorizedException('An active practice owner session is required.');
  }
  return {
    coachId: session.coachId,
    practiceRole: 'owner',
    tenantId: session.tenantId,
    userId: session.userId,
  };
}

@Controller(':surface/setup')
@UseGuards(AuthenticatedSessionGuard)
export class CoachSetupController {
  constructor(private readonly setupService: CoachSetupService) {}

  @Get()
  get(@Param('surface') surface: string, @Req() request: AuthenticatedRequest) {
    return this.setupService.get(setupActor(surface, request));
  }

  @Patch('practice-profile')
  @UseGuards(OriginCsrfGuard)
  savePracticeProfile(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.savePracticeProfile(setupActor(surface, request), body);
  }

  @Patch('coach-profile')
  @UseGuards(OriginCsrfGuard)
  saveCoachProfile(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.saveCoachProfile(setupActor(surface, request), body);
  }

  @Post('profile-photo')
  @UseGuards(OriginCsrfGuard)
  prepareProfilePhoto(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.prepareProfilePhoto(setupActor(surface, request), body);
  }

  @Post('profile-photo/complete')
  @UseGuards(OriginCsrfGuard)
  confirmProfilePhoto(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.confirmProfilePhoto(setupActor(surface, request), body);
  }

  @Post('skip/:item')
  @UseGuards(OriginCsrfGuard)
  skipOptional(
    @Param('surface') surface: string,
    @Param('item') item: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.setupService.skipOptional(setupActor(surface, request), item);
  }

  @Patch('onboarding-defaults')
  @UseGuards(OriginCsrfGuard)
  saveOnboardingDefaults(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.saveOnboardingDefaults(setupActor(surface, request), body);
  }

  @Post('onboarding-defaults/use-defaults')
  @UseGuards(OriginCsrfGuard)
  useDefaultOnboarding(@Param('surface') surface: string, @Req() request: AuthenticatedRequest) {
    return this.setupService.useDefaultOnboarding(setupActor(surface, request));
  }

  @Patch('policies')
  @UseGuards(OriginCsrfGuard)
  savePolicies(
    @Param('surface') surface: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.setupService.savePolicies(setupActor(surface, request), body);
  }

  @Post('policies/use-defaults')
  @UseGuards(OriginCsrfGuard)
  useDefaultPolicies(@Param('surface') surface: string, @Req() request: AuthenticatedRequest) {
    return this.setupService.useDefaultPolicies(setupActor(surface, request));
  }

  @Post('previewed')
  @UseGuards(OriginCsrfGuard)
  markPreviewed(@Param('surface') surface: string, @Req() request: AuthenticatedRequest) {
    return this.setupService.markPreviewed(setupActor(surface, request));
  }
}
