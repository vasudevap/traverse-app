import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Modular monolith root (Decision D18). Domain modules (auth, tenancy, video,
 * payments-flow-a, billing-flow-b, ...) mount here as they are built.
 */
@Module({ controllers: [HealthController] })
export class AppModule {}
