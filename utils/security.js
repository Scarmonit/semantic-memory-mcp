/**
 * Security utilities for Semantic Memory MCP
 * Input validation and sanitization
 */

/**
 * Maximum content size in bytes (10KB)
 */
export const MAX_CONTENT_SIZE = 10 * 1024;

/**
 * Maximum number of tags per memory
 */
export const MAX_TAGS = 20;

/**
 * Maximum tag length
 */
export const MAX_TAG_LENGTH = 100;

/**
 * Sanitize memory content
 * @param {string} content - Raw content
 * @param {number} maxBytes - Maximum allowed bytes
 * @returns {string} - Sanitized content
 * @throws {Error} - If content is invalid
 */
export function sanitizeContent(content, maxBytes = MAX_CONTENT_SIZE) {
  if (typeof content !== 'string') {
    throw new Error('Content must be a string');
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    throw new Error('Content cannot be empty');
  }

  // Check byte length (UTF-8)
  const byteLength = Buffer.byteLength(trimmed, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`Content exceeds maximum size of ${maxBytes} bytes (got ${byteLength})`);
  }

  // Remove null bytes and control characters (except newlines and tabs)
  const sanitized = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return sanitized;
}

/**
 * Validate and sanitize tags array
 * @param {any} tags - Tags to validate
 * @returns {string[]} - Validated tags array
 */
export function validateTags(tags) {
  if (tags === undefined || tags === null) {
    return [];
  }

  if (!Array.isArray(tags)) {
    throw new Error('Tags must be an array');
  }

  if (tags.length > MAX_TAGS) {
    throw new Error(`Maximum ${MAX_TAGS} tags allowed`);
  }

  return tags.map((tag, index) => {
    if (typeof tag !== 'string') {
      throw new Error(`Tag at index ${index} must be a string`);
    }

    const sanitized = tag.trim().toLowerCase();

    if (sanitized.length === 0) {
      throw new Error(`Tag at index ${index} cannot be empty`);
    }

    if (sanitized.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag at index ${index} exceeds maximum length of ${MAX_TAG_LENGTH}`);
    }

    // Only allow alphanumeric, hyphens, underscores
    if (!/^[a-z0-9_-]+$/.test(sanitized)) {
      throw new Error(`Tag at index ${index} contains invalid characters (use only a-z, 0-9, -, _)`);
    }

    return sanitized;
  });
}

/**
 * Validate importance value
 * @param {any} importance - Importance to validate
 * @returns {number} - Validated importance (0-1)
 */
export function validateImportance(importance) {
  if (importance === undefined || importance === null) {
    return 0.5; // default
  }

  const num = parseFloat(importance);

  if (isNaN(num)) {
    throw new Error('Importance must be a number');
  }

  if (num < 0 || num > 1) {
    throw new Error('Importance must be between 0 and 1');
  }

  return num;
}

/**
 * Validate metadata object
 * @param {any} metadata - Metadata to validate
 * @returns {Object} - Validated metadata
 */
export function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return {};
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Metadata must be an object');
  }

  // Check for prototype pollution attempts
  const forbidden = ['__proto__', 'constructor', 'prototype'];
  for (const key of Object.keys(metadata)) {
    if (forbidden.includes(key.toLowerCase())) {
      throw new Error(`Forbidden metadata key: ${key}`);
    }
  }

  // Stringify and parse to remove any circular references and functions
  try {
    const serialized = JSON.stringify(metadata);

    // Check serialized size (max 64KB)
    if (serialized.length > 65536) {
      throw new Error('Metadata exceeds maximum size of 64KB');
    }

    return JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid metadata: ${error.message}`);
  }
}

/**
 * Validate UUID format
 * @param {string} id - ID to validate
 * @returns {string} - Validated UUID
 */
export function validateUUID(id) {
  if (typeof id !== 'string') {
    throw new Error('ID must be a string');
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(id)) {
    throw new Error('Invalid UUID format');
  }

  return id.toLowerCase();
}

/**
 * Validate search query
 * @param {string} query - Search query
 * @returns {string} - Validated query
 */
export function validateQuery(query) {
  if (typeof query !== 'string') {
    throw new Error('Query must be a string');
  }

  const trimmed = query.trim();

  if (trimmed.length === 0) {
    throw new Error('Query cannot be empty');
  }

  if (trimmed.length > 10000) {
    throw new Error('Query exceeds maximum length of 10000 characters');
  }

  return trimmed;
}

/**
 * Validate limit parameter
 * @param {any} limit - Limit to validate
 * @param {number} max - Maximum allowed limit
 * @returns {number} - Validated limit
 */
export function validateLimit(limit, max = 100) {
  if (limit === undefined || limit === null) {
    return 10; // default
  }

  const num = parseInt(limit, 10);

  if (isNaN(num) || num < 1) {
    throw new Error('Limit must be a positive integer');
  }

  return Math.min(num, max);
}

export default {
  sanitizeContent,
  validateTags,
  validateImportance,
  validateMetadata,
  validateUUID,
  validateQuery,
  validateLimit,
  MAX_CONTENT_SIZE,
  MAX_TAGS,
  MAX_TAG_LENGTH,
};
