import { query, withTransaction } from './pool.js';
import { config } from '../config.js';
import { formatEmbeddingForPg } from '../embeddings/generator.js';

/**
 * Memory database queries
 */
export const MemoryQueries = {
  /**
   * Create a new memory
   */
  async create({ content, embedding, summary, tags, importance, metadata, source }) {
    const result = await query(
      `INSERT INTO memories (content, embedding, summary, tags, importance, metadata, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, content, summary, tags, importance, metadata, source, created_at, last_accessed`,
      [
        content,
        formatEmbeddingForPg(embedding),
        summary || null,
        tags || [],
        importance ?? config.defaultImportance,
        metadata || {},
        source || null,
      ]
    );
    return result.rows[0];
  },

  /**
   * Search memories using hybrid scoring (semantic + recency)
   */
  async search({ embedding, limit = 10, minScore = 0.3, tags = null, source = null }) {
    const embeddingStr = formatEmbeddingForPg(embedding);

    let whereConditions = ['deleted_at IS NULL'];
    let params = [embeddingStr, limit];
    let paramIndex = 3;

    if (tags && tags.length > 0) {
      whereConditions.push(`tags && $${paramIndex}`);
      params.push(tags);
      paramIndex++;
    }

    if (source) {
      whereConditions.push(`source = $${paramIndex}`);
      params.push(source);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const result = await query(
      `SELECT
         id, content, summary, tags, importance, metadata, source,
         created_at, last_accessed, access_count,
         (1 - (embedding <=> $1)) AS semantic_score,
         calculate_recency_score(last_accessed, ${config.recencyDecayDays}) AS recency_score,
         calculate_hybrid_score(
           (1 - (embedding <=> $1)),
           last_accessed,
           importance,
           ${config.semanticWeight},
           ${config.recencyWeight},
           ${config.recencyDecayDays}
         ) AS hybrid_score
       FROM memories
       WHERE ${whereClause}
       ORDER BY hybrid_score DESC
       LIMIT $2`,
      params
    );

    // Filter by minimum score
    return result.rows.filter(row => row.hybrid_score >= minScore);
  },

  /**
   * Get memory by ID
   */
  async getById(id) {
    const result = await query(
      `SELECT id, content, summary, tags, importance, metadata, source,
              created_at, last_accessed, access_count, reinforcement_count
       FROM memories
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] || null;
  },

  /**
   * Get multiple memories by IDs
   */
  async getByIds(ids) {
    if (!ids || ids.length === 0) return [];

    const result = await query(
      `SELECT id, content, summary, tags, importance, metadata, source,
              created_at, last_accessed, access_count
       FROM memories
       WHERE id = ANY($1) AND deleted_at IS NULL`,
      [ids]
    );
    return result.rows;
  },

  /**
   * Update memory access (increment count, update timestamp)
   */
  async updateAccess(id, queryText = null, similarity = null) {
    // Log access
    await query(
      `INSERT INTO memory_access_log (memory_id, access_type, query_text, similarity_score)
       VALUES ($1, 'search', $2, $3)`,
      [id, queryText, similarity]
    );

    // Access count and timestamp are updated by trigger
    return true;
  },

  /**
   * Batch update access for multiple memories
   */
  async batchUpdateAccess(ids, queryText = null) {
    if (!ids || ids.length === 0) return;

    const values = ids.map((id, i) =>
      `($${i * 2 + 1}, 'search', $${ids.length * 2 + 1}, NULL)`
    ).join(', ');

    const params = [...ids, queryText];

    await query(
      `INSERT INTO memory_access_log (memory_id, access_type, query_text, similarity_score)
       VALUES ${values}`,
      params
    );
  },

  /**
   * Reinforce a memory (increase importance)
   */
  async reinforce(id, importanceDelta = 0.1) {
    const result = await query(
      `UPDATE memories
       SET importance = LEAST(importance + $2, 1.0),
           reinforcement_count = reinforcement_count + 1,
           last_reinforced = NOW(),
           last_accessed = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, importance, reinforcement_count, last_reinforced`,
      [id, importanceDelta]
    );
    return result.rows[0] || null;
  },

  /**
   * Decay memory importance (soft forget)
   */
  async decay(id, decayFactor = 0.5) {
    const result = await query(
      `UPDATE memories
       SET importance = GREATEST(importance * $2, 0.01)
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, importance`,
      [id, decayFactor]
    );
    return result.rows[0] || null;
  },

  /**
   * Soft delete a memory
   */
  async softDelete(id) {
    const result = await query(
      `UPDATE memories
       SET deleted_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id]
    );
    return result.rowCount > 0;
  },

  /**
   * Hard delete a memory
   */
  async hardDelete(id) {
    const result = await query(
      `DELETE FROM memories WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rowCount > 0;
  },

  /**
   * Forget memories by criteria
   */
  async forgetByCriteria({ tags = null, olderThanDays = null, minImportance = null, soft = true }) {
    let conditions = ['deleted_at IS NULL'];
    let params = [];
    let paramIndex = 1;

    if (tags && tags.length > 0) {
      conditions.push(`tags && $${paramIndex}`);
      params.push(tags);
      paramIndex++;
    }

    if (olderThanDays) {
      conditions.push(`created_at < NOW() - INTERVAL '${parseInt(olderThanDays)} days'`);
    }

    if (minImportance !== null) {
      conditions.push(`importance < $${paramIndex}`);
      params.push(minImportance);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    if (soft) {
      const result = await query(
        `UPDATE memories SET deleted_at = NOW() WHERE ${whereClause} RETURNING id`,
        params
      );
      return result.rowCount;
    } else {
      const result = await query(
        `DELETE FROM memories WHERE ${whereClause} RETURNING id`,
        params
      );
      return result.rowCount;
    }
  },

  /**
   * Get related memories (by vector similarity)
   */
  async getRelated(id, limit = 10) {
    // First get the memory's embedding
    const memory = await query(
      `SELECT embedding FROM memories WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (!memory.rows[0]) return [];

    // Find similar memories (excluding the original)
    const result = await query(
      `SELECT
         id, content, summary, tags, importance, metadata,
         (1 - (embedding <=> $1)) AS similarity
       FROM memories
       WHERE id != $2 AND deleted_at IS NULL
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [memory.rows[0].embedding, id, limit]
    );

    return result.rows;
  },

  /**
   * Get memory statistics
   */
  async getStats() {
    const result = await query(`SELECT * FROM memory_stats`);
    return result.rows[0];
  },
};

/**
 * Memory relationship queries
 */
export const RelationQueries = {
  /**
   * Create a relationship between memories
   */
  async create(sourceId, targetId, relationType, strength = 0.5, metadata = {}) {
    const result = await query(
      `INSERT INTO memory_relations (source_memory_id, target_memory_id, relation_type, strength, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_memory_id, target_memory_id, relation_type)
       DO UPDATE SET strength = EXCLUDED.strength, metadata = EXCLUDED.metadata
       RETURNING id, source_memory_id, target_memory_id, relation_type, strength`,
      [sourceId, targetId, relationType, strength, metadata]
    );
    return result.rows[0];
  },

  /**
   * Get relationships for a memory
   */
  async getByMemory(memoryId, direction = 'both') {
    let condition;
    if (direction === 'outgoing') {
      condition = 'source_memory_id = $1';
    } else if (direction === 'incoming') {
      condition = 'target_memory_id = $1';
    } else {
      condition = 'source_memory_id = $1 OR target_memory_id = $1';
    }

    const result = await query(
      `SELECT r.*,
              s.content as source_content, s.summary as source_summary,
              t.content as target_content, t.summary as target_summary
       FROM memory_relations r
       JOIN memories s ON r.source_memory_id = s.id
       JOIN memories t ON r.target_memory_id = t.id
       WHERE ${condition}
       ORDER BY r.strength DESC`,
      [memoryId]
    );
    return result.rows;
  },

  /**
   * Delete a relationship
   */
  async delete(sourceId, targetId, relationType) {
    const result = await query(
      `DELETE FROM memory_relations
       WHERE source_memory_id = $1 AND target_memory_id = $2 AND relation_type = $3
       RETURNING id`,
      [sourceId, targetId, relationType]
    );
    return result.rowCount > 0;
  },
};

export default { MemoryQueries, RelationQueries };
