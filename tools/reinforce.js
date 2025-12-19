import { MemoryQueries, RelationQueries } from '../db/queries.js';
import { validateUUID } from '../utils/security.js';

export const definition = {
  name: 'reinforce',
  description: 'Reinforce a memory to increase its importance and prevent decay. Use when a memory proves useful or relevant. Can also create explicit relationships between memories.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'UUID of the memory to reinforce.',
      },
      boost: {
        type: 'number',
        description: 'Amount to increase importance by. Default: 0.1. Importance is capped at 1.0.',
        minimum: 0,
        maximum: 0.5,
      },
      relateToMemory: {
        type: 'string',
        description: 'UUID of another memory to create a relationship with.',
      },
      relationType: {
        type: 'string',
        description: 'Type of relationship (e.g., "related_to", "derived_from", "supports", "contradicts"). Default: "related_to".',
        enum: ['related_to', 'derived_from', 'supports', 'contradicts', 'supersedes', 'references'],
      },
      relationStrength: {
        type: 'number',
        description: 'Strength of the relationship (0-1). Default: 0.5.',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['memoryId'],
  },
};

export async function handler(params) {
  try {
    const memoryId = validateUUID(params.memoryId);
    const boost = params.boost ?? 0.1;

    // Reinforce the memory
    const reinforced = await MemoryQueries.reinforce(memoryId, boost);

    if (!reinforced) {
      return {
        success: false,
        error: `Memory not found: ${memoryId}`,
      };
    }

    const result = {
      success: true,
      memory: {
        id: reinforced.id,
        importance: reinforced.importance,
        reinforcementCount: reinforced.reinforcement_count,
        lastReinforced: reinforced.last_reinforced,
      },
      message: `Memory reinforced. New importance: ${reinforced.importance.toFixed(3)}`,
    };

    // Create relationship if requested
    if (params.relateToMemory) {
      const targetId = validateUUID(params.relateToMemory);
      const relationType = params.relationType || 'related_to';
      const relationStrength = params.relationStrength ?? 0.5;

      // Verify target memory exists
      const targetMemory = await MemoryQueries.getById(targetId);
      if (!targetMemory) {
        result.relationError = `Target memory not found: ${targetId}`;
      } else {
        const relation = await RelationQueries.create(
          memoryId,
          targetId,
          relationType,
          relationStrength
        );

        result.relation = {
          id: relation.id,
          sourceId: relation.source_memory_id,
          targetId: relation.target_memory_id,
          type: relation.relation_type,
          strength: relation.strength,
        };
        result.message += ` Created ${relationType} relationship with ${targetId}.`;
      }
    }

    return result;

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default { definition, handler };
