import { defineConfig } from 'drizzle-kit';

const REQUIRED_MIGRATOR_ENV_KEYS = [
  'TIDB_HOST',
  'TIDB_PORT',
  'TIDB_MIGRATOR_USER',
  'TIDB_MIGRATOR_PASSWORD',
  'TIDB_DATABASE',
] as const;

function getMigratorDbCredentials() {
  const missingKeys: string[] = [];

  for (const key of REQUIRED_MIGRATOR_ENV_KEYS) {
    const val = process.env[key];
    if (!val || val.trim().length === 0) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `[mimora-drizzle] Missing required migrator database environment variables: ${missingKeys.join(', ')}. Drizzle Kit requires dedicated migrator credentials and never falls back to runtime TIDB_USER/TIDB_PASSWORD.`
    );
  }

  const parsedPort = Number(process.env.TIDB_PORT!.trim());
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(
      '[mimora-drizzle] Invalid TIDB_PORT configuration: must be an integer between 1 and 65535.'
    );
  }

  return {
    host: process.env.TIDB_HOST!.trim(),
    port: parsedPort,
    user: process.env.TIDB_MIGRATOR_USER!.trim(),
    password: process.env.TIDB_MIGRATOR_PASSWORD!,
    database: process.env.TIDB_DATABASE!.trim(),
    ssl: {
      rejectUnauthorized: true,
    },
  };
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  breakpoints: true,
  strict: true,
  verbose: true,
  dbCredentials: getMigratorDbCredentials(),
});
