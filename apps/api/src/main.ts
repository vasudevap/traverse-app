import 'reflect-metadata';
import { createApp } from './create-app';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  console.log(`traverse api listening on :${port}`);
}
void bootstrap();
