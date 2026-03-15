/**
 * Web Search 工具 - 搜索网络信息
 *
 * 用于 FactChecker 验证事实
 */

import { Tool, ToolResult, createTool } from './registry';

/**
 * Web Search 工具定义
 */
const webSearchDefinition = {
  name: 'web-search',
  description: 'Search the web for information. Returns search results with titles, snippets, and URLs.',
  parameters: {
    query: {
      type: 'string' as const,
      description: 'The search query string'
    },
    maxResults: {
      type: 'number' as const,
      description: 'Maximum number of results to return (default: 5)'
    }
  },
  required: ['query'],
  tags: ['search', 'web', 'fact-check']
};

/**
 * 搜索结果项
 */
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 执行 Web 搜索
 * 当前使用模拟实现，后续可接入真实搜索 API
 */
async function executeWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input.query as string;
  const maxResults = (input.maxResults as number) || 5;

  // 模拟搜索结果
  // 在实际使用中，可以接入:
  // - Google Custom Search API
  // - Bing Search API
  // - DuckDuckGo API
  // - 或其他搜索服务

  const mockResults: SearchResult[] = [
    {
      title: `Search results for: ${query}`,
      url: `https://example.com/search?q=${encodeURIComponent(query)}`,
      snippet: `This is a simulated search result for "${query}". In production, this would return actual web search results.`
    }
  ];

  // 生成模拟结果
  for (let i = 1; i < Math.min(maxResults, 5); i++) {
    mockResults.push({
      title: `Result ${i + 1} for "${query}"`,
      url: `https://example.com/result/${i}`,
      snippet: `Additional information about "${query}" from a reliable source.`
    });
  }

  const output = mockResults.map((r, i) =>
    `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`
  ).join('\n\n');

  return {
    toolName: 'web-search',
    input,
    output,
    success: true,
    timestamp: Date.now(),
    metadata: {
      resultCount: mockResults.length,
      query
    }
  };
}

/**
 * Web Search 工具实例
 */
export const webSearchTool: Tool = createTool(webSearchDefinition, executeWebSearch);

/**
 * 注册 Web Search 工具到注册表
 */
export function registerWebSearchTool(): void {
  const { globalToolRegistry } = require('./registry');
  globalToolRegistry.register(webSearchTool);
}
