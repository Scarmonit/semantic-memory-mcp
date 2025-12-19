import { config } from '../config.js';

/**
 * Calculate recency score using exponential decay
 * @param {Date|string} lastAccessed - Last access timestamp
 * @param {number} decayDays - Number of days for decay half-life
 * @returns {number} - Recency score between 0 and 1
 */
export function calculateRecencyScore(lastAccessed, decayDays = config.recencyDecayDays) {
  const now = Date.now();
  const accessTime = new Date(lastAccessed).getTime();
  const daysSinceAccess = (now - accessTime) / (1000 * 60 * 60 * 24);

  // Exponential decay: e^(-days/decayDays)
  return Math.exp(-daysSinceAccess / decayDays);
}

/**
 * Calculate hybrid score combining semantic similarity and recency
 * @param {number} semanticSimilarity - Cosine similarity (0-1)
 * @param {Date|string} lastAccessed - Last access timestamp
 * @param {number} importance - Memory importance (0-1)
 * @param {Object} options - Optional weight overrides
 * @returns {number} - Hybrid score
 */
export function calculateHybridScore(
  semanticSimilarity,
  lastAccessed,
  importance = config.defaultImportance,
  options = {}
) {
  const semanticWeight = options.semanticWeight ?? config.semanticWeight;
  const recencyWeight = options.recencyWeight ?? config.recencyWeight;
  const decayDays = options.decayDays ?? config.recencyDecayDays;

  const recencyScore = calculateRecencyScore(lastAccessed, decayDays);

  // Base score: weighted combination of semantic and recency
  const baseScore = (semanticWeight * semanticSimilarity) + (recencyWeight * recencyScore);

  // Importance acts as a multiplier (0.5 to 1.5 range)
  const importanceMultiplier = 0.5 + importance;

  return baseScore * importanceMultiplier;
}

/**
 * Generate SQL for hybrid scoring in PostgreSQL
 * Uses pgvector's <=> operator for cosine distance
 * @param {string} embeddingParam - Parameter name for query embedding (e.g., '$1')
 * @returns {string} - SQL expression for hybrid score
 */
export function hybridScoreSQL(embeddingParam = '$1') {
  return `
    calculate_hybrid_score(
      (1 - (embedding <=> ${embeddingParam})),
      last_accessed,
      importance,
      ${config.semanticWeight},
      ${config.recencyWeight},
      ${config.recencyDecayDays}
    )
  `;
}

/**
 * Generate simpler SQL without custom function (fallback)
 * @param {string} embeddingParam - Parameter name for query embedding
 * @returns {string} - SQL expression for hybrid score
 */
export function hybridScoreSQLInline(embeddingParam = '$1') {
  return `
    (
      (1 - (embedding <=> ${embeddingParam})) * ${config.semanticWeight} +
      EXP(-EXTRACT(EPOCH FROM (NOW() - last_accessed)) / (86400 * ${config.recencyDecayDays})) * ${config.recencyWeight}
    ) * (0.5 + importance)
  `;
}

/**
 * Re-rank search results by hybrid score
 * @param {Array} results - Search results with semanticScore and metadata
 * @returns {Array} - Results sorted by hybrid score
 */
export function rerankByHybridScore(results) {
  return results
    .map(result => ({
      ...result,
      hybridScore: calculateHybridScore(
        result.semanticScore || result.similarity || 0,
        result.lastAccessed || result.last_accessed || new Date(),
        result.importance || config.defaultImportance
      ),
    }))
    .sort((a, b) => b.hybridScore - a.hybridScore);
}

export default {
  calculateRecencyScore,
  calculateHybridScore,
  hybridScoreSQL,
  hybridScoreSQLInline,
  rerankByHybridScore,
};
