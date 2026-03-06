# Claude Code 集成设计文档

> **Created:** 2025-03-06
> **Status:** Approved

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        CodeRemote Server                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   WebSocket  │◄──►│   Session    │◄──►│ Claude Code  │      │
│  │   Handler    │    │   Manager    │    │   Engine     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Auth       │    │   History    │    │   Claude CLI │      │
│  │   Manager    │    │   Storage    │    │   / API      │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 消息协议

### 2.1 客户端 → 服务器

```typescript
// 发送消息给 Claude (默认)
{ type: 'claude', content: '帮我分析这段代码', stream: true }

// 发送原始消息 (不走 Claude)
{ type: 'message', content: 'hello', raw: true }
// 或使用前缀
{ type: 'claude', content: '/raw hello' }

// 会话管理
{ type: 'session', action: 'new' | 'resume' | 'list' | 'delete', sessionId?: string }

// 响应模式切换
{ type: 'config', streamMode: 'realtime' | 'segmented' }
```

### 2.2 服务器 → 客户端

```typescript
// 流式响应 (realtime 模式)
{ type: 'claude_stream', content: '这是', done: false }
{ type: 'claude_stream', content: '响应', done: false }
{ type: 'claude_stream', content: '', done: true }

// 分段响应 (segmented 模式)
{ type: 'claude_chunk', content: '这是完整的一段响应...', index: 1, done: false }
{ type: 'claude_chunk', content: '第二段...', index: 2, done: true }

// 会话列表
{ type: 'session_list', sessions: [{ id, title, createdAt, messageCount }] }

// 错误
{ type: 'claude_error', error: 'Claude CLI 未安装', code: 'CLI_NOT_FOUND' }
```

## 3. 会话管理

### 3.1 数据结构

```typescript
interface Session {
  id: string;                    // UUID
  title: string;                 // 首条消息摘要
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];           // 对话历史
  claudeSessionId?: string;      // Claude CLI 的会话 ID (用于 --resume)
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  images?: string[];             // 关联的图片路径
}
```

### 3.2 存储位置

```
E:/CodeRemote/Sessions/{sessionId}.json
```

### 3.3 会话流程

1. 客户端连接 → 自动恢复最近会话
2. 发送消息 → 检查是否有活跃会话，无则创建
3. Claude 响应 → 保存到会话历史
4. 切换会话 → 加载指定会话历史

## 4. Claude Code Engine

### 4.1 类设计

```typescript
class ClaudeCodeEngine {
  // 优先级：Claude CLI > Anthropic API

  async detectClaudeCLI(): Promise<boolean>;

  async sendMessage(
    message: string,
    sessionId?: string,
    streamMode: 'realtime' | 'segmented',
    onChunk: (chunk: string, done: boolean) => void
  ): Promise<void>;

  // 调用 Claude CLI
  private async callClaudeCLI(
    prompt: string,
    sessionFlag?: string,
    onStream: (text: string) => void
  ): Promise<string>;

  // Fallback: 调用 Anthropic API
  private async callAnthropicAPI(
    messages: Message[],
    onStream: (text: string) => void
  ): Promise<string>;
}
```

### 4.2 Claude CLI 调用

```bash
# 流式输出
claude --print --stream "prompt here"

# 恢复会话
claude --resume <session-id> "continue prompt"
```

### 4.3 API Fallback

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

## 5. 流式响应模式

### 5.1 Realtime 模式 (实时流式)

```
Claude: "这" → 客户端显示 "这"
Claude: "是" → 客户端显示 "这是"
Claude: "响应" → 客户端显示 "这是响应"
```

- 每个 token 立即推送
- 打字机效果
- 适合短消息

### 5.2 Segmented 模式 (分段推送)

```
Claude 输出 → 缓冲 → 每 500ms 或换行时推送
```

- 减少网络请求
- 更平滑的显示
- 适合长响应

## 6. 文件结构

```
cli/src/
├── server.ts              # WebSocket 服务器 (已有)
├── claude/
│   ├── index.ts           # 导出
│   ├── engine.ts          # Claude Code Engine
│   ├── session.ts         # Session Manager
│   ├── storage.ts         # History Storage
│   └── types.ts           # 类型定义
├── handlers/
│   ├── claude.ts          # Claude 消息处理
│   └── session.ts         # 会话管理处理
└── config/
    └── claude.ts          # Claude 相关配置

E:/CodeRemote/
├── Images/                # 图片存储 (已有)
├── Sessions/              # 会话存储
│   ├── {uuid-1}.json
│   └── {uuid-2}.json
└── config.json            # 全局配置
```

## 7. 配置项

```typescript
// E:/CodeRemote/config.json
{
  "claude": {
    "preferCLI": true,           // 优先使用 CLI
    "apiKey": "",                // API fallback key
    "streamMode": "realtime",    // 默认流式模式
    "maxHistoryLength": 100,     // 最大历史消息数
    "sessionTimeout": 3600000    // 会话超时 (1小时)
  }
}
```

## 8. 错误处理

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| `CLI_NOT_FOUND` | Claude CLI 未安装 | 提示安装或切换到 API |
| `API_KEY_MISSING` | API Key 未配置 | 提示配置 |
| `RATE_LIMITED` | API 限流 | 等待后重试 |
| `SESSION_NOT_FOUND` | 会话不存在 | 创建新会话 |
| `STREAM_ERROR` | 流式传输错误 | 重试或切换模式 |

## 9. Web 界面更新

```html
<!-- cr-debug.html 新增 -->
<div class="claude-controls">
  <select id="streamMode">
    <option value="realtime">实时流式</option>
    <option value="segmented">分段推送</option>
  </select>
  <button onclick="newSession()">新建会话</button>
  <button onclick="listSessions()">会话列表</button>
</div>

<div class="session-info">
  当前会话: <span id="currentSession">-</span>
</div>
```

## 10. 实现优先级

| 阶段 | 内容 | 预计代码量 |
|------|------|-----------|
| **Phase 1** | Claude CLI 集成 + 流式响应 | ~300 行 |
| **Phase 2** | 会话管理 + 历史存储 | ~200 行 |
| **Phase 3** | API Fallback | ~150 行 |
| **Phase 4** | Web 界面更新 | ~100 行 |
| **Phase 5** | 测试 + 文档 | ~50 行 |

---

## 用户选择记录

- **触发模式:** 混合模式 (默认走 Claude，`/raw` 前缀发送普通消息)
- **响应模式:** 同时实现实时流式和分段推送，可切换
- **调用方式:** 两者都支持 (Claude CLI 优先，API fallback)
- **会话管理:** 服务端保存会话历史
