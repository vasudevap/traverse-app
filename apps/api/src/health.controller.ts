import { Controller, Get } from '@nestjs/common';

/** Liveness for ECS/ALB target-group checks (api-routes.md section 7). No auth, no DB. */
@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'api', ts: new Date().toISOString() };
  }
}
