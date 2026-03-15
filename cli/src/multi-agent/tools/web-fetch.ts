/**
 * Web Fetch 工具 - 获取网页内容
 *
 * 用于 FactChecker 获取详细内容进行验证
 */

import { Tool, ToolResult, createTool } from './registry';

/**
 * Web Fetch 工具定义
 */
const webFetchDefinition = {
  name: 'web-fetch',
  description: 'Fetch and extract content from a web page. Returns the main text content.',
  parameters: {
    url: {
      type: 'string' as const,
      description: 'The URL to fetch'
    },
    selector: {
      type: 'string' as const,
      description: 'Optional CSS selector to extract specific content'
    },
    maxLength: {
      type: 'number' as const,
      description: 'Maximum content length to return (default: 5000 characters)'
    }
  },
  required: ['url'],
  tags: ['fetch', 'web', 'content', 'fact-check']
};

/**
 * 执行 Web Fetch
 * 当前使用模拟实现，后续可接入真实 HTTP 客户端
 */
async function executeWebFetch(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string;
  const maxLength = (input.maxLength as number) || 5000;

  // 模拟获取网页内容
  // 在实际使用中，可以使用:
  // - fetch API (Node.js 18+)
  // - axios
  // - cheerio 解析 HTML

  // 模拟内容
  const mockContent = `
## Content from ${url}

This is simulated content from the web page.

### Key Information
- The page discusses topics related to the search query
- It contains relevant facts and data
- More details would be extracted from the actual page

### Summary
In production, this tool would:
1. Fetch the actual HTML from the URL
2. Parse and extract main content
3. Remove navigation, ads, and other non-essential elements
4. Return clean, readable text

---
Content length: ${Math.min(maxLength, 1000)} characters (truncated for demo)
  `.trim();

  const truncatedContent = mockContent.length > maxLength
    ? mockContent.substring(0, maxLength) + '\n\n[Content truncated...]'
    : mockContent;

  return {
    toolName: 'web-fetch',
    input,
    output: truncatedContent,
    success: true,
    timestamp: Date.now(),
    metadata: {
      url,
      contentLength: truncatedContent.length,
      truncated: mockContent.length > maxLength
    }
  };
}

/**
 * Web Fetch 工具实例
 */
export const webFetchTool: Tool = createTool(webFetchDefinition, executeWebFetch);

/**
 * 注册 Web Fetch 工具到注册表
 */
export function registerWebFetchTool(): void {
  const { globalToolRegistry } = require('./registry');
  globalToolRegistry.register(webFetchTool);
}
