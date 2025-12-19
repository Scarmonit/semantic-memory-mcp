import { MemoryQueries } from '../db/queries.js';
import { generateEmbedding } from '../embeddings/generator.js';
import { sanitizeContent, validateTags, validateImportance, validateMetadata } from '../utils/security.js';

export const definition = {
  name: 'store_memory',
  description: 'Store a new memory with automatic embedding generation. The memory will be indexed for semantic search and can be recalled later based on meaning, not just keywords.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to remember. Can be facts, observations, decisions, code snippets, or any text worth remembering.',
      },
      summary: {
        type: 'string',
        description: 'Optional short summary (1-2 sentences) for quick retrieval.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tags for categorization (e.g., ["project-x", "bug-fix", "decision"]). Use lowercase with hyphens.',
      },
      importance: {
        type: 'number',
        description: 'Importance score from 0 to 1. Higher importance memories are prioritized in search. Default: 0.5',
        minimum: 0,
        maximum: 1,
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata object (e.g., { "source": "chat", "sessionId": "abc123" }).',
      },
      source: {
        type: 'string',
        description: 'Source identifier (e.g., "chat", "code-review", "documentation").',
      },
    },
    required: ['content'],
  },
};

export async function handler(params) {
  try {
    // Validate inputs
    const content = sanitizeContent(params.content);
    const tags = validateTags(params.tags);
    const importance = validateImportance(params.importance);
    const metadata = validateMetadata(params.metadata);
    const summary = params.summary ? sanitizeContent(params.summary, 1024) : null;
    const source = params.source?.trim().slice(0, 100) || null;

    // Generate embedding
    const embedding = await generateEmbedding(content);

    // Store in database
    const memory = await MemoryQueries.create({
      content,
      embedding,
      summary,
      tags,
      importance,
      metadata,
      source,
    });

    return {
      success: true,
      memory: {
        id: memory.id,
        content: memory.content,
        summary: memory.summary,
        tags: memory.tags,
        importance: memory.importance,
        source: memory.source,
        createdAt: memory.created_at,
      },
      message: `Memory stored successfully with ID ${memory.id}`,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default { definition, handler };
