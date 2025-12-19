import { MemoryQueries, RelationQueries } from '../db/queries.js';
import { validateUUID, validateLimit } from '../utils/security.js';

export const definition = {
  name: 'get_related',
  description: 'Find memories related to a given memory. Returns both explicitly linked memories (via relationships) and semantically similar memories (via vector similarity).',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'UUID of the memory to find relations for.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of related memories to return. Default: 10.',
        minimum: 1,
        maximum: 50,
      },
      includeExplicit: {
        type: 'boolean',
        description: 'Include explicitly linked relationships (default: true).',
      },
      includeSimilar: {
        type: 'boolean',
        description: 'Include semantically similar memories (default: true).',
      },
    },
    required: ['memoryId'],
  },
};

export async function handler(params) {
  try {
    // Validate inputs
    const memoryId = validateUUID(params.memoryId);
    const limit = validateLimit(params.limit, 50);
    const includeExplicit = params.includeExplicit !== false;
    const includeSimilar = params.includeSimilar !== false;

    // Get the source memory
    const sourceMemory = await MemoryQueries.getById(memoryId);
    if (!sourceMemory) {
      return {
        success: false,
        error: `Memory not found: ${memoryId}`,
      };
    }

    const related = [];

    // Get explicit relationships
    if (includeExplicit) {
      const relationships = await RelationQueries.getByMemory(memoryId);
      for (const rel of relationships) {
        const isSource = rel.source_memory_id === memoryId;
        related.push({
          id: isSource ? rel.target_memory_id : rel.source_memory_id,
          content: isSource ? rel.target_content : rel.source_content,
          summary: isSource ? rel.target_summary : rel.source_summary,
          relationType: rel.relation_type,
          relationStrength: rel.strength,
          relationDirection: isSource ? 'outgoing' : 'incoming',
          source: 'explicit',
        });
      }
    }

    // Get semantically similar memories
    if (includeSimilar) {
      const similar = await MemoryQueries.getRelated(memoryId, limit);
      for (const mem of similar) {
        // Avoid duplicates from explicit relationships
        if (!related.find(r => r.id === mem.id)) {
          related.push({
            id: mem.id,
            content: mem.content,
            summary: mem.summary,
            tags: mem.tags,
            similarity: parseFloat(mem.similarity?.toFixed(4)),
            source: 'semantic',
          });
        }
      }
    }

    // Sort by strength/similarity and limit
    const sorted = related
      .sort((a, b) => {
        const scoreA = a.relationStrength || a.similarity || 0;
        const scoreB = b.relationStrength || b.similarity || 0;
        return scoreB - scoreA;
      })
      .slice(0, limit);

    return {
      success: true,
      memoryId,
      sourceContent: sourceMemory.content,
      sourceSummary: sourceMemory.summary,
      count: sorted.length,
      related: sorted,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default { definition, handler };
