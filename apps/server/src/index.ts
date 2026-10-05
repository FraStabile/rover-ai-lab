import { buildApp } from './app';
import { configFromEnv, readEnv } from './env';

// node:sqlite prints an ExperimentalWarning on some Node versions; keep the console clean.
const originalEmit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite')) return;
  return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;

const env = readEnv();
const config = configFromEnv();

const rover = await buildApp({
  config,
  databaseFile: env.databaseFile,
  webDist: env.production ? env.webDist : undefined,
  logger: false,
});

process.on('unhandledRejection', (err) => rover.runtime.logger.error('process', `Unhandled rejection: ${String(err)}`));
process.on('uncaughtException', (err) => rover.runtime.logger.error('process', `Uncaught exception: ${err.message}`));

const shutdown = async () => {
  await rover.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await rover.app.listen({ port: env.port, host: env.host });
console.log(`Rover AI Lab server listening on http://localhost:${env.port}  (AI provider: ${config.ai.provider}, db: ${env.databaseFile})`);
if (!env.production) console.log('UI (dev): http://localhost:3000');
