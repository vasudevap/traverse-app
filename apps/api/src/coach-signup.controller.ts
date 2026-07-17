import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { OriginCsrfGuard } from './auth.guards.js';
import { CoachSignupService } from './coach-signup.service.js';

interface SignupRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
}

function forwardedIp(request: SignupRequest, forwardedFor: string | undefined): string | null {
  return (
    forwardedFor?.split(',').at(-1)?.trim() ?? request.ip ?? request.socket?.remoteAddress ?? null
  );
}

@Controller('coach/signup')
export class CoachSignupController {
  constructor(private readonly signupService: CoachSignupService) {}

  @Post()
  @UseGuards(OriginCsrfGuard)
  async create(
    @Body() body: Record<string, unknown>,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('x-forwarded-for') xForwardedFor: string | undefined,
    @Req() request: SignupRequest,
  ) {
    return this.signupService.createSignup(body, {
      ip: forwardedIp(request, xForwardedFor),
      userAgent: userAgent ?? null,
    });
  }

  @Post('verify')
  async verify(@Body() body: { token?: unknown }) {
    return this.signupService.verifyEmail(body.token);
  }
}
