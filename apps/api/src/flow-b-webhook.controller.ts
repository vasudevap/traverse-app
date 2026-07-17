import { Body, Controller, Headers, Inject, Post, RawBody } from '@nestjs/common';
import { CoachSignupService } from './coach-signup.service.js';

@Controller('stripe/flow-b')
export class FlowBWebhookController {
  constructor(
    @Inject(CoachSignupService)
    private readonly signupService: CoachSignupService,
  ) {}

  @Post('webhooks')
  async handle(
    @Body() body: unknown,
    @Headers('stripe-signature') signature: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
  ) {
    return this.signupService.handleFlowBWebhook(body, signature, rawBody);
  }
}
