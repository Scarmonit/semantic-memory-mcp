import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

async function migrate() {
  console.log('Starting database migration...');
  console.log('Database URL:', config.databaseUrl.replace(/:[^:@]+@/, ':****@'));

  const client = new Client({
    connectionString: config.databaseUrl,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Split by semicolons, but preserve function bodies (inside $$ ... $$)
    // Replace semicolons inside $$ blocks with placeholder, then restore
    let processed = schema;
    const functionBodies = [];

    // Extract function bodies (between $$ markers)
    processed = processed.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
      functionBodies.push(match);
      return `__FUNC_BODY_${functionBodies.length - 1}__`;
    });

    // Now split by semicolons
    const statements = processed
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))
      .map(s => {
        // Restore function bodies
        return s.replace(/__FUNC_BODY_(\d+)__/g, (_, idx) => functionBodies[parseInt(idx)]);
      });

    console.log(`Executing ${statements.length} SQL statements...`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        await client.query(statement);
        console.log(`[${i + 1}/${statements.length}] OK`);
      } catch (error) {
        // Skip errors for "already exists" cases
        if (error.code === '42710' || // duplicate_object
            error.code === '42P07' || // duplicate_table
            error.message.includes('already exists')) {
          console.log(`[${i + 1}/${statements.length}] SKIPPED (already exists)`);
        } else {
          console.error(`[${i + 1}/${statements.length}] FAILED:`, error.message);
          console.error('Statement:', statement.substring(0, 100));
          throw error;
        }
      }
    }

    // Verify pgvector extension
    const vectorCheck = await client.query(`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
    `);

    if (vectorCheck.rows.length > 0) {
      console.log(`pgvector extension: v${vectorCheck.rows[0].extversion}`);
    } else {
      console.warn('WARNING: pgvector extension not installed!');
      console.warn('Run: CREATE EXTENSION vector;');
    }

    // Verify tables created
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('memories', 'memory_relations', 'memory_access_log')
    `);

    console.log('Tables created:', tableCheck.rows.map(r => r.table_name).join(', '));

    // Verify HNSW index
    const indexCheck = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'memories'
      AND indexdef LIKE '%hnsw%'
    `);

    if (indexCheck.rows.length > 0) {
      console.log('HNSW index:', indexCheck.rows[0].indexname);
    } else {
      console.warn('WARNING: HNSW index not found on memories table');
    }

    console.log('Migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration
migrate();
