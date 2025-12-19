import { MemoryQueries } from '../db/queries.js';
import { generateEmbedding, generateEmbeddings } from '../embeddings/generator.js';
import { validateQuery, validateLimit } from '../utils/security.js';

export const definition = {
  name: 'recall_context',
  description: 'Recall relevant memories for a task or context. Combines multiple queries (task + context items) to find the most relevant memories. Ideal for gathering context before starting work.',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The main task or question you need context for.',
      },
      context: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional context strings to search for (e.g., file names, function names, error messages).',
      },
      limit: {
        type: 'integer',
        description: 'Maximum total memories to return (after deduplication). Default: 10.',
        minimum: 1,
        maximum: 50,
      },
      minScore: {
        type: 'number',
        description: 'Minimum score threshold. Default: 0.25 (lower than search_memory to catch more context).',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['task'],
  },
};

export async function handler(params) {
  try {
    // Validate inputs
    const task = validateQuery(params.task);
    const contextItems = params.context || [];
    const limit = validateLimit(params.limit, 50);
    const minScore = params.minScore ?? 0.25;

    // Prepare all queries
    const queries = [task, ...contextItems.slice(0, 10)]; // Max 10 context items

    // Generate embeddings for all queries in batch
    const embeddings = await generateEmbeddings(queries);

    // Search for each query
    const allResults = new Map(); // Use Map to deduplicate by ID

    for (let i = 0; i < embeddings.length; i++) {
      const embedding = embeddings[i];
      const queryText = queries[i];

      const results = await MemoryQueries.search({
        embedding,
        limit: Math.ceil(limit / queries.length) + 5, // Get extra to account for deduplication
        minScore,
      });

      for (const result of results) {
        const existing = allResults.get(result.id);
        if (!existing || result.hybrid_score > existing.hybrid_score) {
          // Keep the result with the highest score
          allResults.set(result.id, {
            ...result,
            matchedQuery: queryText,
          });
        }
      }
    }

    // Convert to array, sort by score, and limit
    const combined = Array.from(allResults.values())
      .sort((a, b) => b.hybrid_score - a.hybrid_score)
      .slice(0, limit);

    // Update access counts (async, non-blocking)
    if (combined.length > 0) {
      const memoryIds = combined.map(r => r.id);
      MemoryQueries.batchUpdateAccess(memoryIds, task).catch(err => {
        console.error('Failed to update access counts:', err.message);
      });
    }

    return {
      success: true,
      task,
      contextQueries: contextItems.length,
      count: combined.length,
      memories: combined.map(r => ({
        id: r.id,
        content: r.content,
        summary: r.summary,
        tags: r.tags,
        importance: r.importance,
        source: r.source,
        matchedQuery: r.matchedQuery,
        scores: {
          hybrid: parseFloat(r.hybrid_score?.toFixed(4)),
          semantic: parseFloat(r.semantic_score?.toFixed(4)),
        },
        createdAt: r.created_at,
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
