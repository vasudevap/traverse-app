import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** Create the Nest application without binding a port, so boot behavior is testable. */
export function createApp(options: NestApplicationOptions = {}) {
  return NestFactory.create(AppModule, options);
}
