import { config } from '../config.js';

/**
 * Generate embedding for a single text using Ollama
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector (768 dimensions for nomic-embed-text)
 */
export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  // Truncate very long texts (nomic-embed-text has 8192 token context)
  const truncatedText = text.slice(0, 32000);

  const response = await fetch(`${config.ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      prompt: truncatedText,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama embedding failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Invalid embedding response from Ollama');
  }

  // Verify dimension matches expected
  if (data.embedding.length !== config.embeddingDimension) {
    console.warn(`Embedding dimension mismatch: expected ${config.embeddingDimension}, got ${data.embedding.length}`);
  }

  return data.embedding;
}

/**
 * Generate embeddings for multiple texts (batch processing)
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts)) {
    throw new Error('Texts must be an array');
  }

  // Process in parallel with concurrency limit
  const concurrency = 5;
  const results = [];

  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(text => generateEmbedding(text))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Check if Ollama is available and the embedding model is loaded
 * @returns {Promise<{available: boolean, model?: string, error?: string}>}
 */
export async function checkOllamaHealth() {
  try {
    // Check if Ollama is running
    const response = await fetch(`${config.ollamaUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { available: false, error: 'Ollama not responding' };
    }

    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some(m =>
      m.name === config.embeddingModel ||
      m.name.startsWith(config.embeddingModel + ':')
    );

    if (!hasModel) {
      return {
        available: false,
        error: `Model ${config.embeddingModel} not found. Run: ollama pull ${config.embeddingModel}`,
        models: models.map(m => m.name),
      };
    }

    return {
      available: true,
      model: config.embeddingModel,
      dimension: config.embeddingDimension,
    };

  } catch (error) {
    return {
      available: false,
      error: error.message,
    };
  }
}

/**
 * Format embedding array for PostgreSQL pgvector
 * @param {number[]} embedding - Embedding vector
 * @returns {string} - PostgreSQL vector literal
 */
export function formatEmbeddingForPg(embedding) {
  return `[${embedding.join(',')}]`;
}

export default {
  generateEmbedding,
  generateEmbeddings,
  checkOllamaHealth,
  formatEmbeddingForPg,
};
