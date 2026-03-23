# WebSocket 协议示例

本示例展示如何通过 WebSocket 连接 CodeRemote 后端服务器。

## 快速开始

```bash
# 1. 启动后端服务器
cd apps/server
npm install
npm run build
node .\\dist\\index.js start

# 服务器会显示:
# - URL: ws://localhost:8080
# - Token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# - QR Code: ████...
```

## 基础连接 (basic-connection.ts)

```typescript
import WebSocket from 'ws';

// 连接服务器
const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

ws.on('open', () => {
  console.log('✅ 已连接到服务器');

  // 发送认证
  ws.send(JSON.stringify({
    type: 'auth',
    token: TOKEN
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 收到消息:', msg);

  switch (msg.type) {
    case 'auth_success':
      console.log('✅ 认证成功，客户端ID:', msg.clientId);
      break;
    case 'auth_failed':
      console.log('❌ 认证失败');
      ws.close();
      break;
    case 'message':
      console.log('💬 消息内容:', msg.content);
      break;
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket 错误:', error);
});

ws.on('close', () => {
  console.log('🔌 连接已关闭');
});
```

## 消息发送 (message-sending.ts)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

ws.on('open', () => {
  // 认证
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'auth_success') {
    // 发送普通消息
    sendChatMessage('你好，请帮我分析这段代码');

    // 发送命令
    sendCommand('/help');

    // 发送多智能体讨论请求
    startDiscussion('如何设计一个高并发系统？');
  }
});

// 发送聊天消息
function sendChatMessage(content: string) {
  ws.send(JSON.stringify({
    type: 'message',
    content: content
  }));
}

// 发送斜杠命令
function sendCommand(command: string) {
  ws.send(JSON.stringify({
    type: 'message',
    content: command
  }));
}

// 启动多智能体讨论
function startDiscussion(topic: string, expertContext?: string) {
  ws.send(JSON.stringify({
    type: 'discussion',
    action: 'start',
    topic: topic,
    expertContext: expertContext
  }));
}
```

## 会话管理 (session-management.ts)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'auth_success') {
    // 获取当前项目的会话列表
    listSessions();

    // 获取所有项目
    // listAllProjects();
  }

  switch (msg.type) {
    case 'session_list':
      console.log('📋 会话列表:', msg.sessions);
      break;
    case 'project_list':
      console.log('📁 项目列表:', msg.projects);
      break;
    case 'session_created':
      console.log('✅ 会话已创建:', msg.sessionId);
      break;
    case 'session_loaded':
      console.log('✅ 会话已加载:', msg.sessionId);
      console.log('消息数量:', msg.messages?.length);
      break;
  }
});

// 获取当前项目会话列表
function listSessions() {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'list'
  }));
}

// 获取所有项目
function listAllProjects() {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'list_projects'
  }));
}

// 获取指定项目的会话
function listProjectSessions(projectId: string) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'list_by_project',
    projectId: projectId
  }));
}

// 创建新会话
function createSession() {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'new'
  }));
}

// 恢复会话
function resumeSession(sessionId: string, projectId?: string) {
  const msg: any = {
    type: 'session',
    action: 'resume',
    sessionId: sessionId
  };
  if (projectId) {
    msg.projectId = projectId;
  }
  ws.send(JSON.stringify(msg));
}

// 删除会话
function deleteSession(sessionId: string, projectId?: string) {
  const msg: any = {
    type: 'session',
    action: 'delete',
    sessionId: sessionId
  };
  if (projectId) {
    msg.projectId = projectId;
  }
  ws.send(JSON.stringify(msg));
}

// 重命名会话
function renameSession(sessionId: string, title: string) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'rename',
    sessionId: sessionId,
    title: title
  }));
}

// 加载更多消息（分页）
function loadMoreMessages(sessionId: string, beforeIndex: number, limit: number = 20) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'load_more',
    sessionId: sessionId,
    beforeIndex: beforeIndex,
    limit: limit
  }));
}
```

## 多项目历史 (multi-project.ts)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

interface ProjectInfo {
  id: string;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
}

interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'auth_success':
      loadAllProjects();
      break;

    case 'project_list':
      handleProjectList(msg.projects);
      break;

    case 'session_list':
      if (msg.projectId) {
        console.log(`📋 项目 ${msg.projectId} 的会话:`, msg.sessions);
      }
      break;

    case 'session_loaded':
      console.log('📄 会话消息:', msg.messages);
      break;
  }
});

// 加载所有项目
function loadAllProjects() {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'list_projects'
  }));
}

// 处理项目列表
function handleProjectList(projects: ProjectInfo[]) {
  console.log(`📁 找到 ${projects.length} 个项目:`);

  projects.forEach(project => {
    console.log(`  - ${project.displayName}`);
    console.log(`    会话数: ${project.sessionCount}`);
    console.log(`    最后活动: ${new Date(project.lastActivity).toLocaleString()}`);
  });

  // 加载第一个项目的会话
  if (projects.length > 0) {
    loadProjectSessions(projects[0].id);
  }
}

// 加载项目会话
function loadProjectSessions(projectId: string) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'list_by_project',
    projectId: projectId
  }));
}

// 跨项目恢复会话
function restoreCrossProjectSession(projectId: string, sessionId: string) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'resume',
    projectId: projectId,
    sessionId: sessionId
  }));
}

// 跨项目删除会话
function deleteCrossProjectSession(projectId: string, sessionId: string) {
  ws.send(JSON.stringify({
    type: 'session',
    action: 'delete',
    projectId: projectId,
    sessionId: sessionId
  }));
}
```

## 流式响应处理 (streaming-response.ts)

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'auth_success':
      // 发送消息触发流式响应
      ws.send(JSON.stringify({
        type: 'message',
        content: '请帮我写一个快速排序算法'
      }));
      break;

    case 'message':
      // 流式消息包含 content 和 isStreaming
      if (msg.isStreaming) {
        // 追加内容（流式更新）
        process.stdout.write(msg.content);
      } else {
        // 消息完成
        console.log('\n✅ 消息完成');
      }

      // 处理 thinking 内容
      if (msg.thinking) {
        console.log('\n💭 Thinking:', msg.thinking);
      }

      // 处理工具调用
      if (msg.tools && msg.tools.length > 0) {
        msg.tools.forEach((tool: any) => {
          console.log(`🔧 工具调用: ${tool.toolName}`);
        });
      }
      break;

    case 'error':
      console.error('❌ 错误:', msg.content);
      if (msg.canRetry) {
        console.log('🔄 可以重试');
      }
      break;
  }
});
```

## 图片发送 (image-transfer.ts)

```typescript
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const ws = new WebSocket('ws://localhost:8080');
const TOKEN = 'your-token-here';

// 发送图片
async function sendImage(imagePath: string) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };

  ws.send(JSON.stringify({
    type: 'image',
    data: base64,
    mimeType: mimeTypes[ext] || 'image/png',
    filename: path.basename(imagePath)
  }));
}

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'auth_success') {
    // 发送图片
    sendImage('./screenshot.png');
  }

  if (msg.type === 'message') {
    console.log('💬', msg.content);
  }
});
```

## 完整客户端类 (client.ts)

```typescript
import WebSocket from 'ws';

interface CodeRemoteOptions {
  url: string;
  token: string;
  onMessage?: (content: string, isStreaming: boolean) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

class CodeRemoteClient {
  private ws: WebSocket | null = null;
  private options: CodeRemoteOptions;
  private isConnected = false;
  private isAuthenticated = false;

  constructor(options: CodeRemoteOptions) {
    this.options = options;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.ws!.send(JSON.stringify({
          type: 'auth',
          token: this.options.token
        }));
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'auth_success':
            this.isAuthenticated = true;
            this.options.onConnect?.();
            resolve();
            break;

          case 'auth_failed':
            reject(new Error('认证失败'));
            break;

          case 'message':
            this.options.onMessage?.(msg.content, msg.isStreaming);
            break;

          case 'error':
            this.options.onError?.(msg.content);
            break;
        }
      });

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.isAuthenticated = false;
        this.options.onDisconnect?.();
      });
    });
  }

  send(content: string) {
    if (!this.isAuthenticated) {
      throw new Error('未认证');
    }
    this.ws!.send(JSON.stringify({ type: 'message', content }));
  }

  createSession() {
    this.ws!.send(JSON.stringify({ type: 'session', action: 'new' }));
  }

  listSessions() {
    this.ws!.send(JSON.stringify({ type: 'session', action: 'list' }));
  }

  resumeSession(sessionId: string, projectId?: string) {
    const msg: any = { type: 'session', action: 'resume', sessionId };
    if (projectId) msg.projectId = projectId;
    this.ws!.send(JSON.stringify(msg));
  }

  disconnect() {
    this.ws?.close();
  }
}

// 使用示例
const client = new CodeRemoteClient({
  url: 'ws://localhost:8080',
  token: 'your-token-here',
  onConnect: () => console.log('✅ 已连接'),
  onDisconnect: () => console.log('🔌 已断开'),
  onMessage: (content, isStreaming) => {
    if (isStreaming) {
      process.stdout.write(content);
    } else {
      console.log('\n✅ 完成');
    }
  },
  onError: (error) => console.error('❌', error)
});

await client.connect();
client.send('你好！');
```

## 消息类型参考

### 客户端 → 服务器

| 类型 | 说明 |
|------|------|
| `auth` | 认证请求 |
| `message` | 发送消息 |
| `image` | 发送图片 |
| `session` | 会话操作 (list/new/resume/delete/rename/load_more) |
| `discussion` | 多智能体讨论 |

### 服务器 → 客户端

| 类型 | 说明 |
|------|------|
| `auth_success` | 认证成功 |
| `auth_failed` | 认证失败 |
| `message` | 消息响应（流式） |
| `error` | 错误消息 |
| `session_list` | 会话列表 |
| `project_list` | 项目列表 |
| `session_created` | 会话已创建 |
| `session_loaded` | 会话已加载 |
| `discussion_started` | 讨论已开始 |
| `discussion_message` | 讨论消息 |
| `discussion_ended` | 讨论已结束 |
