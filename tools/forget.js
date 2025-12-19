import { MemoryQueries } from '../db/queries.js';
import { validateUUID, validateTags } from '../utils/security.js';

export const definition = {
  name: 'forget',
  description: 'Forget memories by ID or criteria. By default uses "soft forget" which decays importance rather than deleting. Use hard delete for permanent removal.',
  inputSchema: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'UUID of a specific memory to forget.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Forget all memories with ANY of these tags.',
      },
      olderThanDays: {
        type: 'integer',
        description: 'Forget memories older than this many days.',
        minimum: 1,
      },
      belowImportance: {
        type: 'number',
        description: 'Forget memories with importance below this threshold.',
        minimum: 0,
        maximum: 1,
      },
      soft: {
        type: 'boolean',
        description: 'If true (default), decay importance to near-zero instead of deleting. If false, permanently delete.',
      },
      decayFactor: {
        type: 'number',
        description: 'For soft forget, multiply importance by this factor. Default: 0.1 (reduce to 10%).',
        minimum: 0,
        maximum: 1,
      },
    },
  },
};

export async function handler(params) {
  try {
    const soft = params.soft !== false; // Default to soft forget
    const decayFactor = params.decayFactor ?? 0.1;
    let forgotten = 0;

    // Forget specific memory by ID
    if (params.memoryId) {
      const memoryId = validateUUID(params.memoryId);

      if (soft) {
        const result = await MemoryQueries.decay(memoryId, decayFactor);
        if (result) {
          forgotten = 1;
          return {
            success: true,
            method: 'soft',
            forgotten: 1,
            memory: {
              id: result.id,
              newImportance: result.importance,
            },
            message: `Memory ${memoryId} importance decayed to ${result.importance.toFixed(3)}`,
          };
        } else {
          return {
            success: false,
            error: `Memory not found: ${memoryId}`,
          };
        }
      } else {
        const deleted = await MemoryQueries.hardDelete(memoryId);
        return {
          success: deleted,
          method: 'hard',
          forgotten: deleted ? 1 : 0,
          message: deleted
            ? `Memory ${memoryId} permanently deleted`
            : `Memory not found: ${memoryId}`,
        };
      }
    }

    // Forget by criteria
    const hasCriteria = params.tags || params.olderThanDays || params.belowImportance !== undefined;

    if (!hasCriteria) {
      return {
        success: false,
        error: 'Must provide memoryId or at least one criteria (tags, olderThanDays, belowImportance)',
      };
    }

    const tags = params.tags ? validateTags(params.tags) : null;
    const olderThanDays = params.olderThanDays ? parseInt(params.olderThanDays) : null;
    const minImportance = params.belowImportance;

    forgotten = await MemoryQueries.forgetByCriteria({
      tags,
      olderThanDays,
      minImportance,
      soft,
    });

    const criteria = [];
    if (tags) criteria.push(`tags: [${tags.join(', ')}]`);
    if (olderThanDays) criteria.push(`older than ${olderThanDays} days`);
    if (minImportance !== undefined) criteria.push(`importance < ${minImportance}`);

    return {
      success: true,
      method: soft ? 'soft' : 'hard',
      forgotten,
      criteria: criteria.join(', '),
      message: `${soft ? 'Soft deleted' : 'Permanently deleted'} ${forgotten} memories matching criteria: ${criteria.join(', ')}`,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default { definition, handler };
