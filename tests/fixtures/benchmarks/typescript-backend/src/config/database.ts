import { PoolOptions } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/keystone';

const poolConfig: PoolOptions = {
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export interface DatabaseConfig {
  url: string;
  pool: PoolOptions;
}

export const getDatabaseConfig = (): DatabaseConfig => ({
  url: DATABASE_URL,
  pool: poolConfig,
});
