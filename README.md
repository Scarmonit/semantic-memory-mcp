# Semantic Memory MCP Server

Persistent semantic memory for AI agents using PostgreSQL + pgvector. Enables AI agents to store, search, and recall memories based on meaning, not just keywords.

## Features

- **Semantic Search**: Find memories by meaning using vector embeddings
- **Hybrid Scoring**: 80% semantic similarity + 20% recency for natural memory behavior
- **Memory Decay**: Memories fade over time unless reinforced
- **Knowledge Graph**: Create explicit relationships between memories
- **Local Embeddings**: Uses Ollama with nomic-embed-text (no external API costs)

## Quick Start

### Prerequisites

1. **PostgreSQL 16+** with pgvector extension
2. **Ollama** with nomic-embed-text model
3. **Node.js 18+**

### Setup

```bash
# Clone the repository
git clone https://github.com/Scarmonit/semantic-memory-mcp.git
cd semantic-memory-mcp

# Install dependencies
npm install

# Pull the embedding model
ollama pull nomic-embed-text

# Configure environment
cp .env.example .env
# Edit .env with your database URL

# Run migrations
npm run migrate

# Start the server
npm start
```

## MCP Tools

### store_memory
Store content with auto-generated embeddings.

```json
{
  "tool": "store_memory",
  "params": {
    "content": "The user prefers dark mode and uses VS Code",
    "tags": ["preferences", "user"],
    "importance": 0.8
  }
}
```

### search_memory
Semantic search with hybrid scoring.

```json
{
  "tool": "search_memory",
  "params": {
    "query": "What are the user's editor preferences?",
    "limit": 5
  }
}
```

### recall_context
Gather context for a task using multiple queries.

```json
{
  "tool": "recall_context",
  "params": {
    "task": "Help fix the authentication bug",
    "context": ["login.js", "auth middleware", "JWT tokens"]
  }
}
```

### get_related
Find memories related to a specific memory.

```json
{
  "tool": "get_related",
  "params": {
    "memoryId": "uuid-here",
    "limit": 10
  }
}
```

### reinforce
Strengthen important memories.

```json
{
  "tool": "reinforce",
  "params": {
    "memoryId": "uuid-here",
    "boost": 0.2
  }
}
```

### forget
Decay or remove memories.

```json
{
  "tool": "forget",
  "params": {
    "tags": ["temporary"],
    "olderThanDays": 30,
    "soft": true
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with database and Ollama status |
| `/mcp/tools` | GET | List available MCP tools |
| `/mcp/execute` | POST | Execute a tool |
| `/mcp` | POST | JSON-RPC 2.0 endpoint |

## Hybrid Scoring Algorithm

Memories are ranked by a combination of:

```
hybrid_score = (semantic * 0.8 + recency * 0.2) * importance
```

- **Semantic**: Cosine similarity between query and memory embeddings
- **Recency**: Exponential decay based on last access time (30-day half-life)
- **Importance**: User-assigned weight (0-1), boosted by reinforcement

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3325 | Server port |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `OLLAMA_URL` | http://localhost:11434 | Ollama API URL |
| `EMBEDDING_MODEL` | nomic-embed-text | Model for embeddings |
| `EMBEDDING_DIMENSION` | 768 | Vector dimensions |
| `SEMANTIC_WEIGHT` | 0.8 | Weight for semantic similarity |
| `RECENCY_WEIGHT` | 0.2 | Weight for recency |
| `RECENCY_DECAY_DAYS` | 30 | Half-life for recency decay |

## Database Schema

The server uses PostgreSQL with the pgvector extension:

- **memories**: Stores content, embeddings, metadata
- **memory_relations**: Explicit relationships between memories
- **memory_access_log**: Access tracking for analytics

HNSW index provides fast approximate nearest neighbor search with 95%+ recall.

## Deployment

### Render

Use the included `render.yaml` blueprint:

1. Connect your repo to Render
2. Select "Blueprint" deployment
3. Render will provision PostgreSQL with pgvector automatically

Note: Ollama requires a separate deployment or external service for production.

## Integration with Temporal Agent

Schedule recurring memory maintenance:

```javascript
// Weekly memory cleanup
{
  "cron": "0 3 * * 0",
  "payload": {
    "tool": "forget",
    "params": {
      "belowImportance": 0.1,
      "olderThanDays": 90,
      "soft": true
    }
  }
}
```

## License

MIT
