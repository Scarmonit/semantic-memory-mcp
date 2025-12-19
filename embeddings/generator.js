import { config } from '../config.js';

/**
 * Generate embedding for a single text
 * Supports multiple providers: Ollama (local) or OpenAI (cloud)
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  // Truncate very long texts
  const truncatedText = text.slice(0, 32000);

  // Use configured provider
  if (config.embeddingProvider === 'openai' && config.openaiApiKey) {
    return generateOpenAIEmbedding(truncatedText);
  }

  // Default to Ollama
  return generateOllamaEmbedding(truncatedText);
}

/**
 * Generate embedding using Ollama (local)
 */
async function generateOllamaEmbedding(text) {
  const response = await fetch(`${config.ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      prompt: text,
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

  return normalizeEmbeddingDimension(data.embedding);
}

/**
 * Generate embedding using OpenAI API (cloud)
 */
async function generateOpenAIEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiEmbeddingModel,
      input: text,
      dimensions: config.embeddingDimension, // OpenAI supports dimension reduction
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} - ${error}`);
  }

  const data = await response.json();

  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid embedding response from OpenAI');
  }

  return normalizeEmbeddingDimension(data.data[0].embedding);
}

/**
 * Normalize embedding to configured dimension
 * Pads with zeros or truncates as needed
 */
function normalizeEmbeddingDimension(embedding) {
  if (embedding.length === config.embeddingDimension) {
    return embedding;
  }

  if (embedding.length > config.embeddingDimension) {
    console.warn(`Truncating embedding from ${embedding.length} to ${config.embeddingDimension} dimensions`);
    return embedding.slice(0, config.embeddingDimension);
  }

  console.warn(`Padding embedding from ${embedding.length} to ${config.embeddingDimension} dimensions`);
  return [...embedding, ...new Array(config.embeddingDimension - embedding.length).fill(0)];
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
 * Check if embedding service is available
 * Checks the configured provider (Ollama or OpenAI)
 * @returns {Promise<{available: boolean, provider?: string, model?: string, error?: string}>}
 */
export async function checkEmbeddingHealth() {
  const TIMEOUT_MS = 3000;

  // Check OpenAI if configured
  if (config.embeddingProvider === 'openai' && config.openaiApiKey) {
    return checkOpenAIHealth(TIMEOUT_MS);
  }

  // Default to Ollama
  return _checkOllamaHealth(TIMEOUT_MS);
}

async function _checkOllamaHealth(timeoutMs) {
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Ollama health check timed out')), timeoutMs);
    });

    const fetchPromise = fetch(`${config.ollamaUrl}/api/tags`, {
      method: 'GET',
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      return { available: false, provider: 'ollama', error: 'Ollama not responding' };
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
        provider: 'ollama',
        error: `Model ${config.embeddingModel} not found. Run: ollama pull ${config.embeddingModel}`,
        models: models.map(m => m.name),
      };
    }

    return {
      available: true,
      provider: 'ollama',
      model: config.embeddingModel,
      dimension: config.embeddingDimension,
    };

  } catch (error) {
    return {
      available: false,
      provider: 'ollama',
      error: error.message,
    };
  }
}

async function checkOpenAIHealth(timeoutMs) {
  try {
    // Simple validation - OpenAI API key exists and is valid format
    if (!config.openaiApiKey || config.openaiApiKey.length < 20) {
      return {
        available: false,
        provider: 'openai',
        error: 'Invalid or missing OPENAI_API_KEY',
      };
    }

    // Test with a minimal embedding request
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI health check timed out')), timeoutMs);
    });

    const fetchPromise = fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiEmbeddingModel,
        input: 'test',
        dimensions: config.embeddingDimension,
      }),
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      const error = await response.text();
      return {
        available: false,
        provider: 'openai',
        error: `OpenAI API error: ${response.status}`,
      };
    }

    return {
      available: true,
      provider: 'openai',
      model: config.openaiEmbeddingModel,
      dimension: config.embeddingDimension,
    };

  } catch (error) {
    return {
      available: false,
      provider: 'openai',
      error: error.message,
    };
  }
}

// Backward compatibility alias
export const checkOllamaHealth = checkEmbeddingHealth;

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
  checkEmbeddingHealth,
  checkOllamaHealth, // backward compat
  formatEmbeddingForPg,
};
