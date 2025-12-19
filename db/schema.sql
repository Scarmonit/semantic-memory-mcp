-- Semantic Memory MCP - Database Schema
-- PostgreSQL with pgvector extension

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- Main Memories Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Content
    content TEXT NOT NULL,
    summary TEXT,  -- Optional short summary for quick retrieval

    -- Vector embedding (nomic-embed-text: 768 dimensions)
    embedding vector(768),

    -- Metadata
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    source TEXT,  -- Where this memory came from (session, tool, user, etc.)

    -- Memory strength and decay
    importance FLOAT DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
    access_count INTEGER DEFAULT 0,
    reinforcement_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed TIMESTAMPTZ DEFAULT NOW(),
    last_reinforced TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,  -- Optional expiration

    -- Soft delete
    deleted_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT content_not_empty CHECK (length(trim(content)) > 0)
);

-- =============================================================================
-- Memory Relations (Graph Edges)
-- =============================================================================
CREATE TABLE IF NOT EXISTS memory_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    target_memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,  -- 'related_to', 'derived_from', 'contradicts', 'supports', etc.
    strength FLOAT DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent self-references and duplicates
    CONSTRAINT no_self_reference CHECK (source_memory_id != target_memory_id),
    CONSTRAINT unique_relation UNIQUE (source_memory_id, target_memory_id, relation_type)
);

-- =============================================================================
-- Memory Access Log (for analytics and recency tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS memory_access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    access_type TEXT NOT NULL,  -- 'search', 'recall', 'reinforce', 'relate'
    query_text TEXT,  -- The query that accessed this memory
    similarity_score FLOAT,
    metadata JSONB DEFAULT '{}',
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- HNSW index for vector similarity search (high recall)
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx ON memories
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- B-tree indexes for common queries
CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories (created_at DESC);
CREATE INDEX IF NOT EXISTS memories_last_accessed_idx ON memories (last_accessed DESC);
CREATE INDEX IF NOT EXISTS memories_importance_idx ON memories (importance DESC);
CREATE INDEX IF NOT EXISTS memories_source_idx ON memories (source);
CREATE INDEX IF NOT EXISTS memories_deleted_at_idx ON memories (deleted_at) WHERE deleted_at IS NULL;

-- GIN index for tags array search
CREATE INDEX IF NOT EXISTS memories_tags_idx ON memories USING GIN (tags);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS memories_metadata_idx ON memories USING GIN (metadata);

-- Relation indexes
CREATE INDEX IF NOT EXISTS memory_relations_source_idx ON memory_relations (source_memory_id);
CREATE INDEX IF NOT EXISTS memory_relations_target_idx ON memory_relations (target_memory_id);
CREATE INDEX IF NOT EXISTS memory_relations_type_idx ON memory_relations (relation_type);

-- Access log indexes
CREATE INDEX IF NOT EXISTS memory_access_log_memory_idx ON memory_access_log (memory_id);
CREATE INDEX IF NOT EXISTS memory_access_log_accessed_at_idx ON memory_access_log (accessed_at DESC);

-- =============================================================================
-- Functions
-- =============================================================================

-- Function to calculate recency score (0-1, higher = more recent)
CREATE OR REPLACE FUNCTION calculate_recency_score(
    last_accessed TIMESTAMPTZ,
    decay_days INTEGER DEFAULT 30
) RETURNS FLOAT AS $$
DECLARE
    days_since_access FLOAT;
BEGIN
    days_since_access := EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400.0;
    -- Exponential decay: score = e^(-days/decay_days)
    RETURN EXP(-days_since_access / decay_days);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate hybrid score
CREATE OR REPLACE FUNCTION calculate_hybrid_score(
    semantic_similarity FLOAT,
    last_accessed TIMESTAMPTZ,
    importance FLOAT,
    semantic_weight FLOAT DEFAULT 0.8,
    recency_weight FLOAT DEFAULT 0.2,
    decay_days INTEGER DEFAULT 30
) RETURNS FLOAT AS $$
DECLARE
    recency_score FLOAT;
    base_score FLOAT;
BEGIN
    recency_score := calculate_recency_score(last_accessed, decay_days);
    base_score := (semantic_weight * semantic_similarity) + (recency_weight * recency_score);
    -- Boost by importance (importance acts as a multiplier between 0.5 and 1.5)
    RETURN base_score * (0.5 + importance);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update access stats
CREATE OR REPLACE FUNCTION update_memory_access()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE memories
    SET
        last_accessed = NOW(),
        access_count = access_count + 1
    WHERE id = NEW.memory_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update access stats
CREATE TRIGGER memory_access_trigger
AFTER INSERT ON memory_access_log
FOR EACH ROW
EXECUTE FUNCTION update_memory_access();

-- =============================================================================
-- Views
-- =============================================================================

-- Active memories view (excludes soft-deleted and expired)
CREATE OR REPLACE VIEW active_memories AS
SELECT * FROM memories
WHERE deleted_at IS NULL
AND (expires_at IS NULL OR expires_at > NOW());

-- Memory stats view
CREATE OR REPLACE VIEW memory_stats AS
SELECT
    COUNT(*) as total_memories,
    COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_memories,
    COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_memories,
    AVG(importance) as avg_importance,
    AVG(access_count) as avg_access_count,
    MAX(created_at) as latest_memory,
    MIN(created_at) as oldest_memory
FROM memories;
