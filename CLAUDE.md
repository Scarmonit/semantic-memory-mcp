# Claude Code Project Context

**Version: 1.1.0**

## Project Overview

**semantic-memory-mcp** is an MCP (Model Context Protocol) server providing persistent semantic memory for AI agents using PostgreSQL + pgvector. It enables agents to store, search, and recall memories based on meaning rather than keywords.

## What's New in v1.1.0

- **Multi-Provider Embeddings**: Support for both Ollama (local) and OpenAI (cloud)
- **Production-Ready**: OpenAI embeddings work on Render without local GPU
- **Automatic Dimension Normalization**: Handles embedding dimension mismatches

## Architecture

```
semantic-memory-mcp/
├── index.js                    # MCP server (Express, port 3325)
├── config.js                   # Environment configuration
├── package.json
├── render.yaml                 # Render deployment blueprint
├── db/
│   ├── schema.sql             # PostgreSQL + pgvector schema
│   ├── pool.js                # Connection pool
│   ├── migrate.js             # Migration runner
│   └── queries.js             # Memory query builders
├── tools/
│   ├── index.js               # Tool registry
│   ├── store_memory.js        # Store with embeddings
│   ├── search_memory.js       # Semantic search
│   ├── get_related.js         # Find connections
│   ├── recall_context.js      # Task-relevant memories
│   ├── forget.js              # Memory decay/removal
│   └── reinforce.js           # Strengthen memories
├── embeddings/
│   └── generator.js           # Multi-provider embedding client (Ollama/OpenAI)
└── utils/
    ├── hybrid-search.js       # 80/20 semantic/recency scoring
    └── security.js            # Input validation
```

## MCP Tools Reference (6 tools)

| Tool | Description |
|------|-------------|
| `store_memory` | Store content with auto-generated embeddings |
| `search_memory` | Semantic search with hybrid scoring |
| `get_related` | Find connected/related memories |
| `recall_context` | Task-relevant memory recall |
| `forget` | Decay or remove memories |
| `reinforce` | Strengthen important memories |

## Development Commands

```bash
# Install dependencies
npm install

# Pull embedding model
ollama pull nomic-embed-text

# Run migrations
npm run migrate

# Start server
npm start
npm run dev  # with auto-reload
```

## Key Algorithms

### Hybrid Scoring
```javascript
hybrid_score = (semantic * 0.8 + recency * 0.2) * importance

// Recency uses exponential decay with 30-day half-life
recency = e^(-days_since_access / 30)
```

### HNSW Index
- m = 16 (connections per layer)
- ef_construction = 64 (build quality)
- 95%+ recall for approximate nearest neighbor search

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3325 | Server port |
| `DATABASE_URL` | - | PostgreSQL connection |
| `EMBEDDING_PROVIDER` | ollama | 'ollama' or 'openai' |
| `OLLAMA_URL` | http://localhost:11434 | Ollama API (local) |
| `EMBEDDING_MODEL` | nomic-embed-text | Ollama model name |
| `EMBEDDING_DIMENSION` | 768 | Vector dimension |
| `OPENAI_API_KEY` | - | OpenAI API key (for cloud) |
| `OPENAI_EMBEDDING_MODEL` | text-embedding-3-small | OpenAI model |
| `SEMANTIC_WEIGHT` | 0.8 | Semantic similarity weight |
| `RECENCY_WEIGHT` | 0.2 | Recency decay weight |

### Production Setup (Render)
```bash
# Set in Render dashboard
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

## Database Requirements

- PostgreSQL 16+
- pgvector extension
- uuid-ossp extension

## Integration Points

- **Temporal Agent MCP**: Schedule memory maintenance tasks
- **Jules Orchestration**: Store session outcomes and patterns
- **Future Agent Reflection MCP**: Track success/failure patterns

## Code Style

- ES Modules (`"type": "module"`)
- Single quotes, semicolons
- 2-space indentation
- Async/await for promises
