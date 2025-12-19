import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3325', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/semantic_memory',
  dbPoolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),

  // Embeddings
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),

  // Hybrid Search Weights
  semanticWeight: parseFloat(process.env.SEMANTIC_WEIGHT || '0.8'),
  recencyWeight: parseFloat(process.env.RECENCY_WEIGHT || '0.2'),

  // Memory Settings
  defaultImportance: parseFloat(process.env.DEFAULT_IMPORTANCE || '0.5'),
  recencyDecayDays: parseInt(process.env.RECENCY_DECAY_DAYS || '30', 10),
  maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS || '20', 10),

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),

  // Security
  apiKey: process.env.API_KEY || '',
};

export default config;
