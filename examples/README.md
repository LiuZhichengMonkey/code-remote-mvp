# CodeRemote 示例代码

本目录包含 CodeRemote 项目的各种使用示例。

## 📁 目录结构

```
examples/
├── websocket/           # WebSocket 协议示例
│   └── README.md        # 完整的协议文档和示例代码
├── multi-agent/         # 多智能体系统示例
│   ├── basic-debate.ts  # 基础辩论示例
│   ├── parallel-debate.ts # 并行辩论示例
│   └── eventbus-usage.ts # EventBus 使用示例
├── agents/              # Agent 配置示例
│   └── README.md        # Agent 配置文档
└── frontend/            # 前端集成示例
    ├── vanilla-js.html  # 纯 JavaScript 示例
    └── react-hook.tsx   # React Hook 示例
```

## 🚀 快速开始

### 1. WebSocket 连接

```bash
# 启动服务器
cd cli && npm start

# 在另一个终端测试连接
node examples/websocket/test-connection.js
```

### 2. 多智能体辩论

```bash
# 运行基础辩论示例
cd cli
npx tsx ../examples/multi-agent/basic-debate.ts basic

# 运行并行辩论示例
npx tsx ../examples/multi-agent/parallel-debate.ts basic

# 运行 EventBus 示例
npx tsx ../examples/multi-agent/eventbus-usage.ts basic
```

### 3. 前端集成

```bash
# 纯 JS 示例 - 直接在浏览器打开
open examples/frontend/vanilla-js.html

# React 示例 - 复制到项目中使用
# 参考 react-hook.tsx 中的 useCodeRemote Hook
```

## 📖 示例详情

### WebSocket 示例

| 示例 | 说明 |
|------|------|
| `basic-connection.ts` | 基础连接和认证 |
| `message-sending.ts` | 发送消息和命令 |
| `session-management.ts` | 会话管理（创建、恢复、删除） |
| `multi-project.ts` | 多项目历史操作 |
| `streaming-response.ts` | 流式响应处理 |
| `image-transfer.ts` | 图片发送 |
| `client.ts` | 完整的客户端类 |

### Multi-Agent 示例

| 示例 | 说明 |
|------|------|
| `basic-debate.ts` | 基础辩论、自定义 LLM、人工干预 |
| `parallel-debate.ts` | 并行辩论、超时处理、多轮辩论 |
| `eventbus-usage.ts` | EventBus 消息总线、请求-响应、主题订阅 |

### Agent 配置示例

| 格式 | 说明 |
|------|------|
| YAML 格式 | 完整配置，推荐使用 |
| Markdown 格式 | 简化配置，适合快速创建 |
| 记忆 Agent | 带记忆持久化的 Agent |
| 辩论 Agent | 辩论角色配置 |

### 前端示例

| 示例 | 说明 |
|------|------|
| `vanilla-js.html` | 纯 JavaScript，无依赖 |
| `react-hook.tsx` | React Hook 封装 |

## 🔧 常用代码片段

### 连接服务器

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: 'your-token' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'auth_success') {
    console.log('已连接！');
  }
});
```

### 发送消息

```typescript
// 发送普通消息
ws.send(JSON.stringify({
  type: 'message',
  content: '你好！'
}));

// 发送命令
ws.send(JSON.stringify({
  type: 'message',
  content: '/help'
}));

// 发送讨论请求
ws.send(JSON.stringify({
  type: 'discussion',
  action: 'start',
  topic: '如何设计高并发系统？',
  expertContext: '资深架构师，精通分布式系统'
}));
```

### 创建辩论

```typescript
import { DebateOrchestrator, ClaudeCLIAdapter } from './multi-agent';

const debate = DebateOrchestrator.create(
  'AI 是否会取代程序员？',
  { name: '技术专家', background: '资深软件架构师' },
  { maxRounds: 5, terminationScore: 85 }
);

debate.setLLMInvoker(async (prompt, systemPrompt) => {
  // 调用 LLM API
  return await callLLM(prompt, systemPrompt);
});

while (debate.getState().status === 'running') {
  await debate.runRound();
}
```

### 使用 EventBus

```typescript
import { EventBus } from './multi-agent';

const bus = new EventBus();

// 注册 Agent
bus.register('proposer', async (message) => {
  console.log('收到消息:', message.payload);
});

// 广播消息
await bus.broadcast('system', { announcement: '开始！' });

// 单播消息
await bus.publish({
  type: 'request',
  from: 'moderator',
  to: 'proposer',
  payload: { question: '你的观点？' }
});
```

## 📚 更多资源

- [README.md](../README.md) - 项目概述
- [DEVELOPMENT.md](../DEVELOPMENT.md) - 开发指南
- [TESTING.md](../TESTING.md) - 测试指南
- [multi-agent/README.md](../cli/src/multi-agent/README.md) - 多智能体系统文档
