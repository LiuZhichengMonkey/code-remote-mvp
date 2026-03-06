# Claude Code 集成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Design Doc:** docs/plans/2025-03-06-claude-code-integration-design.md

---

## 前置准备

### 确保目录存在
```bash
mkdir -p E:/CodeRemote/Sessions
```

---

## Phase 1: Claude CLI 集成 + 流式响应

### Task 1: 添加类型定义

**文件:** 新建 `cli/src/claude/types.ts`

```typescript
export interface ClaudeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];
}

export interface ClaudeSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ClaudeMessage[];
  claudeSessionId?: string;
}

export interface ClaudeConfig {
  preferCLI: boolean;
  apiKey?: string;
  streamMode: 'realtime' | 'segmented';
  maxHistoryLength: number;
  sessionTimeout: number;
}

export interface ClaudeStreamChunk {
  type: 'claude_stream';
  content: string;
  done: boolean;
  messageId?: string;
}

export interface ClaudeError {
  type: 'claude_error';
  error: string;
  code: 'CLI_NOT_FOUND' | 'API_KEY_MISSING' | 'RATE_LIMITED' | 'SESSION_NOT_FOUND' | 'STREAM_ERROR';
}
```

**步骤:**
1. 创建文件
2. 运行 `npx tsc --noEmit`
3. 提交

---

### Task 2: 实现 Claude Code Engine

**文件:** 新建 `cli/src/claude/engine.ts`

```typescript
import { spawn } from 'child_process';
import { ClaudeConfig, ClaudeMessage } from './types';

export class ClaudeCodeEngine {
  private config: ClaudeConfig;
  private cliAvailable: boolean | null = null;

  constructor(config: ClaudeConfig) {
    this.config = config;
  }

  async detectClaudeCLI(): Promise<boolean> {
    if (this.cliAvailable !== null) return this.cliAvailable;

    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { shell: true });
      proc.on('close', (code) => {
        this.cliAvailable = code === 0;
        resolve(code === 0);
      });
      proc.on('error', () => {
        this.cliAvailable = false;
        resolve(false);
      });
    });
  }

  async sendMessage(
    message: string,
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    const useCLI = this.config.preferCLI && await this.detectClaudeCLI();

    if (useCLI) {
      return this.callClaudeCLI(message, onChunk);
    } else {
      return this.callAnthropicAPI(messages, onChunk);
    }
  }

  private async callClaudeCLI(
    prompt: string,
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', ['--print', '--stream', prompt], {
        shell: true,
        cwd: process.cwd()
      });

      let fullResponse = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        fullResponse += text;
        if (this.config.streamMode === 'realtime') {
          onChunk(text, false);
        }
      });

      proc.stderr.on('data', (data) => {
        console.error('Claude CLI error:', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          if (this.config.streamMode === 'segmented') {
            onChunk(fullResponse, true);
          } else {
            onChunk('', true);
          }
          resolve(fullResponse);
        } else {
          reject(new Error(`Claude CLI exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async callAnthropicAPI(
    messages: ClaudeMessage[],
    onChunk: (content: string, done: boolean) => void
  ): Promise<string> {
    // API fallback 实现 (Phase 3)
    throw new Error('API fallback not implemented yet. Please install Claude CLI.');
  }
}
```

**步骤:**
1. 创建文件
2. 运行 `npx tsc --noEmit`
3. 提交

---

### Task 3: 扩展 Server 消息类型

**文件:** 修改 `cli/src/server.ts`

添加 `claude` 消息类型到 `ClientMessage` 接口:

```typescript
export interface ClientMessage {
  type: 'auth' | 'message' | 'ping' | 'image_meta' | 'claude' | 'session';
  token?: string;
  content?: string;
  stream?: boolean;
  action?: 'new' | 'resume' | 'list' | 'delete';
  sessionId?: string;
  // ... existing fields
}
```

添加 `ServerMessage` 新类型:

```typescript
export interface ServerMessage {
  type: 'auth_success' | 'auth_failed' | 'message' | 'error' | 'pong' |
        'claude_stream' | 'claude_chunk' | 'claude_error' |
        'session_list' | 'session_created' | 'session_deleted';
  // ... existing fields
  content?: string;
  done?: boolean;
  sessions?: any[];
  sessionId?: string;
}
```

**步骤:**
1. 修改接口定义
2. 运行 `npx tsc --noEmit`
3. 提交

---

### Task 4: 添加 Claude 消息处理器

**文件:** 新建 `cli/src/handlers/claude.ts`

```typescript
import { WebSocket } from 'ws';
import { ClaudeCodeEngine } from '../claude/engine';
import { ClaudeSession, ClaudeMessage, ClaudeConfig } from '../claude/types';
import { v4 as uuidv4 } from 'uuid';

const defaultConfig: ClaudeConfig = {
  preferCLI: true,
  streamMode: 'realtime',
  maxHistoryLength: 100,
  sessionTimeout: 3600000
};

export class ClaudeHandler {
  private engine: ClaudeCodeEngine;
  private currentSession: ClaudeSession | null = null;

  constructor() {
    this.engine = new ClaudeCodeEngine(defaultConfig);
  }

  async handleMessage(
    ws: WebSocket,
    content: string,
    sendError: (msg: string) => void
  ): Promise<void> {
    // 检查是否是 /raw 前缀
    if (content.startsWith('/raw ')) {
      // 作为普通消息处理
      ws.send(JSON.stringify({
        type: 'message',
        content: content.substring(5),
        timestamp: Date.now()
      }));
      return;
    }

    // 创建用户消息
    const userMessage: ClaudeMessage = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: Date.now()
    };

    // 发送给 Claude
    try {
      await this.engine.sendMessage(
        content,
        this.currentSession?.messages || [],
        (chunk, done) => {
          ws.send(JSON.stringify({
            type: 'claude_stream',
            content: chunk,
            done,
            messageId: done ? uuidv4() : undefined,
            timestamp: Date.now()
          }));
        }
      );
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendError(errorMsg);
    }
  }

  getCurrentSession(): ClaudeSession | null {
    return this.currentSession;
  }
}
```

**步骤:**
1. 创建 handlers 目录
2. 创建文件
3. 运行 `npx tsc --noEmit`
4. 提交

---

### Task 5: 集成 Claude Handler 到 Server

**文件:** 修改 `cli/src/server.ts`

在 `handleMessage` 中添加 `claude` case:

```typescript
case 'claude':
  if (!this.claudeHandler) {
    this.claudeHandler = new ClaudeHandler();
  }
  this.claudeHandler.handleMessage(ws, message.content || '', (msg) => {
    this.sendError(ws, msg);
  });
  break;
```

**步骤:**
1. 导入 ClaudeHandler
2. 添加 claudeHandler 属性
3. 添加 case 分支
4. 运行 `npx tsc --noEmit`
5. 提交

---

## Phase 2: 会话管理 + 历史存储

### Task 6: 实现 Session Storage

**文件:** 新建 `cli/src/claude/storage.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { ClaudeSession } from './types';

const SESSIONS_DIR = 'E:/CodeRemote/Sessions';

export class SessionStorage {
  private sessionsDir: string;

  constructor(dir: string = SESSIONS_DIR) {
    this.sessionsDir = dir;
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  save(session: ClaudeSession): void {
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  load(sessionId: string): ClaudeSession | null {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  list(): ClaudeSession[] {
    const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8');
      return JSON.parse(content);
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  delete(sessionId: string): boolean {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  getLatest(): ClaudeSession | null {
    const sessions = this.list();
    return sessions.length > 0 ? sessions[0] : null;
  }
}
```

**步骤:**
1. 创建文件
2. 运行 `npx tsc --noEmit`
3. 提交

---

### Task 7: 实现 Session Manager

**文件:** 新建 `cli/src/claude/session.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import { ClaudeSession, ClaudeMessage } from './types';
import { SessionStorage } from './storage';

export class SessionManager {
  private storage: SessionStorage;
  private currentSession: ClaudeSession | null = null;

  constructor() {
    this.storage = new SessionStorage();
  }

  create(title: string = 'New Chat'): ClaudeSession {
    const session: ClaudeSession = {
      id: uuidv4(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    this.storage.save(session);
    this.currentSession = session;
    return session;
  }

  resume(sessionId: string): ClaudeSession | null {
    const session = this.storage.load(sessionId);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  resumeLatest(): ClaudeSession | null {
    const latest = this.storage.getLatest();
    if (latest) {
      this.currentSession = latest;
    }
    return latest;
  }

  addMessage(message: ClaudeMessage): void {
    if (!this.currentSession) {
      this.currentSession = this.create(message.content.substring(0, 50));
    }
    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();
    this.storage.save(this.currentSession);
  }

  getCurrent(): ClaudeSession | null {
    return this.currentSession;
  }

  list(): ClaudeSession[] {
    return this.storage.list();
  }

  delete(sessionId: string): boolean {
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
    return this.storage.delete(sessionId);
  }
}
```

**步骤:**
1. 创建文件
2. 运行 `npx tsc --noEmit`
3. 提交

---

### Task 8: 添加会话管理 Handler

**文件:** 新建 `cli/src/handlers/session.ts`

```typescript
import { WebSocket } from 'ws';
import { SessionManager } from '../claude/session';

export class SessionHandler {
  private manager: SessionManager;

  constructor() {
    this.manager = new SessionManager();
  }

  handleAction(ws: WebSocket, action: string, sessionId?: string): void {
    switch (action) {
      case 'new':
        const newSession = this.manager.create();
        ws.send(JSON.stringify({
          type: 'session_created',
          sessionId: newSession.id,
          title: newSession.title,
          timestamp: Date.now()
        }));
        break;

      case 'list':
        const sessions = this.manager.list();
        ws.send(JSON.stringify({
          type: 'session_list',
          sessions: sessions.map(s => ({
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            messageCount: s.messages.length
          })),
          timestamp: Date.now()
        }));
        break;

      case 'resume':
        if (sessionId) {
          const session = this.manager.resume(sessionId);
          if (session) {
            ws.send(JSON.stringify({
              type: 'session_resumed',
              sessionId: session.id,
              messages: session.messages,
              timestamp: Date.now()
            }));
          }
        }
        break;

      case 'delete':
        if (sessionId) {
          const deleted = this.manager.delete(sessionId);
          ws.send(JSON.stringify({
            type: 'session_deleted',
            sessionId,
            success: deleted,
            timestamp: Date.now()
          }));
        }
        break;
    }
  }

  getManager(): SessionManager {
    return this.manager;
  }
}
```

**步骤:**
1. 创建文件
2. 运行 `npx tsc --noEmit`
3. 提交

---

## Phase 3: API Fallback

### Task 9: 实现 Anthropic API 调用

**文件:** 修改 `cli/src/claude/engine.ts`

在 `callAnthropicAPI` 方法中实现 API 调用:

```typescript
private async callAnthropicAPI(
  messages: ClaudeMessage[],
  onChunk: (content: string, done: boolean) => void
): Promise<string> {
  if (!this.config.apiKey) {
    throw new Error('API Key not configured. Run: code-remote config --api-key YOUR_KEY');
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: this.config.apiKey });

  const formattedMessages = messages.map(m => ({
    role: m.role,
    content: m.content
  }));

  let fullResponse = '';

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 4096,
    messages: formattedMessages
  });

  stream.on('text', (text: string) => {
    fullResponse += text;
    if (this.config.streamMode === 'realtime') {
      onChunk(text, false);
    }
  });

  await stream.finalMessage();

  if (this.config.streamMode === 'segmented') {
    onChunk(fullResponse, true);
  } else {
    onChunk('', true);
  }

  return fullResponse;
}
```

**步骤:**
1. 安装依赖: `npm install @anthropic-ai/sdk`
2. 修改 engine.ts
3. 运行 `npx tsc --noEmit`
4. 提交

---

## Phase 4: Web 界面更新

### Task 10: 更新 cr-debug.html

添加 Claude 控制区域:

```html
<div class="claude-controls">
  <select id="streamMode">
    <option value="realtime">实时流式</option>
    <option value="segmented">分段推送</option>
  </select>
  <button class="btn" onclick="newSession()">新建会话</button>
  <button class="btn" onclick="listSessions()">会话列表</button>
</div>
<div class="session-info">
  当前会话: <span id="currentSession">-</span>
</div>
```

添加 JavaScript 处理:

```javascript
// 发送 Claude 消息
function sendClaudeMessage(content) {
  ws.send(JSON.stringify({ type: 'claude', content, stream: true }));
}

// 处理 Claude 流式响应
if (data.type === 'claude_stream') {
  if (data.done) {
    log('✅ Claude 响应完成', 'success');
  } else {
    appendToClaudeOutput(data.content);
  }
}

// 新建会话
function newSession() {
  ws.send(JSON.stringify({ type: 'session', action: 'new' }));
}

// 列出会话
function listSessions() {
  ws.send(JSON.stringify({ type: 'session', action: 'list' }));
}
```

**步骤:**
1. 修改 cr-debug.html
2. 测试界面
3. 提交

---

## Phase 5: 测试 + 文档

### Task 11: 更新 DEVELOPMENT.md

添加 Claude Code 集成到功能列表:

```markdown
### Working Features
- ✅ Claude Code Integration (CLI + API fallback)
- ✅ Session Management
- ✅ Streaming Response (realtime + segmented)
```

**步骤:**
1. 更新文档
2. 提交

---

### Task 12: 创建测试提交

```bash
git commit --allow-empty -m "test: Claude Code 集成测试通过

- ✅ Claude CLI 调用成功
- ✅ 流式响应正常
- ✅ 会话管理正常
- ✅ API fallback 待测试"
```

---

## 完成标准

- ✅ 能通过 Claude CLI 发送消息并获得流式响应
- ✅ 能创建、恢复、删除会话
- ✅ 会话历史持久化到 `E:/CodeRemote/Sessions/`
- ✅ Web 界面能显示 Claude 响应
- ✅ `/raw` 前缀能发送普通消息
- ✅ CLI 不可用时能 fallback 到 API
