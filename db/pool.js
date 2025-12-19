import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Log pool errors
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

/**
 * Execute a query with parameters
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (config.nodeEnv === 'development') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }

  return result;
}

/**
 * Get a client for transaction support
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Execute queries within a transaction
 */
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database health including pgvector extension
 */
export async function checkHealth() {
  try {
    // Basic connectivity
    const result = await pool.query('SELECT NOW() as time');

    // Check pgvector extension
    const vectorCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) as has_vector
    `);

    return {
      connected: true,
      timestamp: result.rows[0].time,
      pgvector: vectorCheck.rows[0].has_vector,
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingConnections: pool.waitingCount,
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
}

/**
 * Gracefully close the pool
 */
export async function closePool() {
  await pool.end();
}

export default pool;
