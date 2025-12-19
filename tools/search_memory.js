import { MemoryQueries } from '../db/queries.js';
import { generateEmbedding } from '../embeddings/generator.js';
import { validateQuery, validateTags, validateLimit } from '../utils/security.js';

export const definition = {
  name: 'search_memory',
  description: 'Search memories using semantic similarity. Returns memories ranked by a hybrid score combining meaning similarity (80%) and recency (20%). More important memories are boosted.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query. The query will be embedded and compared against stored memories by meaning.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results to return. Default: 10, Max: 100.',
        minimum: 1,
        maximum: 100,
      },
      minScore: {
        type: 'number',
        description: 'Minimum hybrid score threshold (0-1). Default: 0.3. Higher values return more relevant but fewer results.',
        minimum: 0,
        maximum: 1,
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter results to only memories with ANY of these tags.',
      },
      source: {
        type: 'string',
        description: 'Filter results to only memories from this source.',
      },
    },
    required: ['query'],
  },
};

export async function handler(params) {
  try {
    // Validate inputs
    const queryText = validateQuery(params.query);
    const limit = validateLimit(params.limit, 100);
    const minScore = params.minScore ?? 0.3;
    const tags = params.tags ? validateTags(params.tags) : null;
    const source = params.source?.trim() || null;

    // Generate query embedding
    const embedding = await generateEmbedding(queryText);

    // Search memories
    const results = await MemoryQueries.search({
      embedding,
      limit,
      minScore,
      tags,
      source,
    });

    // Update access counts for returned memories (async, non-blocking)
    if (results.length > 0) {
      const memoryIds = results.map(r => r.id);
      MemoryQueries.batchUpdateAccess(memoryIds, queryText).catch(err => {
        console.error('Failed to update access counts:', err.message);
      });
    }

    return {
      success: true,
      query: queryText,
      count: results.length,
      memories: results.map(r => ({
        id: r.id,
        content: r.content,
        summary: r.summary,
        tags: r.tags,
        importance: r.importance,
        source: r.source,
        scores: {
          hybrid: parseFloat(r.hybrid_score?.toFixed(4)),
          semantic: parseFloat(r.semantic_score?.toFixed(4)),
          recency: parseFloat(r.recency_score?.toFixed(4)),
        },
        createdAt: r.created_at,
        lastAccessed: r.last_accessed,
        accessCount: r.access_count,
      })),
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default { definition, handler };
