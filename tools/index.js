import storeMemory from './store_memory.js';
import searchMemory from './search_memory.js';
import getRelated from './get_related.js';
import recallContext from './recall_context.js';
import forget from './forget.js';
import reinforce from './reinforce.js';

/**
 * All MCP tools
 */
export const tools = [
  storeMemory,
  searchMemory,
  getRelated,
  recallContext,
  forget,
  reinforce,
];

/**
 * Tool definitions for MCP protocol
 */
export const toolDefinitions = tools.map(tool => tool.definition);

/**
 * Tool handlers map
 */
export const toolHandlers = new Map(
  tools.map(tool => [tool.definition.name, tool.handler])
);

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {Object} params - Tool parameters
 * @returns {Promise<Object>} - Tool result
 */
export async function executeTool(name, params = {}) {
  const handler = toolHandlers.get(name);

  if (!handler) {
    return {
      success: false,
      error: `Unknown tool: ${name}`,
      availableTools: Array.from(toolHandlers.keys()),
    };
  }

  try {
    return await handler(params);
  } catch (error) {
    console.error(`Tool ${name} error:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  tools,
  toolDefinitions,
  toolHandlers,
  executeTool,
};
