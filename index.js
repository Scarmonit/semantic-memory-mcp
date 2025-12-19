import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { checkHealth as checkDbHealth, closePool } from './db/pool.js';
import { checkEmbeddingHealth } from './embeddings/generator.js';
import { toolDefinitions, executeTool } from './tools/index.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// =============================================================================
// Health Check
// =============================================================================
app.get('/health', async (req, res) => {
  try {
    const [dbHealth, embeddingHealth] = await Promise.all([
      checkDbHealth(),
      checkEmbeddingHealth(),
    ]);

    // Core health: database must be connected with pgvector
    // Embedding service is optional - service is degraded without it but still functional for reads
    const coreHealthy = dbHealth.connected && dbHealth.pgvector;
    const fullyHealthy = coreHealthy && embeddingHealth.available;

    res.status(coreHealthy ? 200 : 503).json({
      status: fullyHealthy ? 'healthy' : (coreHealthy ? 'degraded' : 'unhealthy'),
      service: 'semantic-memory-mcp',
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      database: dbHealth,
      embeddings: embeddingHealth,
      note: !embeddingHealth.available
        ? `Embedding service unavailable (${embeddingHealth.provider || 'unknown'}) - store_memory and search_memory require embeddings`
        : undefined,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// =============================================================================
// MCP Protocol Endpoints
// =============================================================================

// List available tools
app.get('/mcp/tools', (req, res) => {
  res.json({
    tools: toolDefinitions,
  });
});

// Execute a tool
app.post('/mcp/execute', async (req, res) => {
  try {
    const { tool, params } = req.body;

    if (!tool) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: tool',
      });
    }

    const result = await executeTool(tool, params || {});
    res.json(result);

  } catch (error) {
    console.error('Tool execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// JSON-RPC endpoint (MCP standard)
app.post('/mcp', async (req, res) => {
  try {
    const { jsonrpc, id, method, params } = req.body;

    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid JSON-RPC version' },
      });
    }

    let result;

    switch (method) {
      case 'tools/list':
        result = { tools: toolDefinitions };
        break;

      case 'tools/call':
        if (!params?.name) {
          return res.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' },
          });
        }
        result = await executeTool(params.name, params.arguments || {});
        break;

      case 'ping':
        result = { pong: true };
        break;

      default:
        return res.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }

    res.json({
      jsonrpc: '2.0',
      id,
      result,
    });

  } catch (error) {
    console.error('JSON-RPC error:', error);
    res.json({
      jsonrpc: '2.0',
      id: req.body?.id,
      error: { code: -32603, message: error.message },
    });
  }
});

// =============================================================================
// Root endpoint
// =============================================================================
app.get('/', (req, res) => {
  res.json({
    name: 'Semantic Memory MCP Server',
    version: '1.0.0',
    description: 'Persistent semantic memory for AI agents using PostgreSQL + pgvector',
    endpoints: {
      health: 'GET /health',
      tools: 'GET /mcp/tools',
      execute: 'POST /mcp/execute',
      jsonRpc: 'POST /mcp',
    },
    tools: toolDefinitions.map(t => t.name),
  });
});

// =============================================================================
// Error handling
// =============================================================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: config.nodeEnv === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// =============================================================================
// Server startup
// =============================================================================
const server = app.listen(config.port, config.host, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Semantic Memory MCP Server v1.1.0               ║
╠════════════════════════════════════════════════════════════╣
║  Status:    Running                                        ║
║  Port:      ${config.port.toString().padEnd(44)}║
║  Host:      ${config.host.padEnd(44)}║
║  Env:       ${config.nodeEnv.padEnd(44)}║
║  Embeddings: ${config.embeddingProvider.padEnd(43)}║
╠════════════════════════════════════════════════════════════╣
║  Endpoints:                                                ║
║    GET  /health      - Health check                        ║
║    GET  /mcp/tools   - List available tools                ║
║    POST /mcp/execute - Execute a tool                      ║
║    POST /mcp         - JSON-RPC endpoint                   ║
╠════════════════════════════════════════════════════════════╣
║  Tools: store_memory, search_memory, get_related,          ║
║         recall_context, forget, reinforce                  ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log('HTTP server closed');

    try {
      await closePool();
      console.log('Database pool closed');
    } catch (error) {
      console.error('Error closing database pool:', error);
    }

    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
