# 多智能体对抗与分析引擎

Multi-Agent Adversarial Analysis Engine

## 概述

通过**对抗与辩论**机制，对复杂问题进行多维度深度剖析的系统。

### 核心特性

- **全局黑板机制**：解决上下文爆炸问题
- **防爆机制**：废话零容忍、状态大于历史、强制垃圾回收
- **多角色对抗**：建构者 vs 破坏者 + 查证员 + 动态专家
- **共识评分**：自动判断何时终止辩论
- **🆕 并发执行**：多Agent同时响应，性能提升N倍
- **🆕 消息总线**：EventBus支持单播/广播/主题订阅
- **🆕 异步锁**：黑板并发安全，读写锁机制

## 架构

```
multi-agent/
├── index.ts              # 模块导出
├── types.ts              # 类型定义
├── blackboard.ts         # 全局黑板（记忆管理）
├── agents.ts             # Agent 角色定义
├── orchestrator.ts       # 辩论协调器（状态机）
├── llm-adapter.ts        # LLM 适配器
├── prompt-loader.ts      # Prompt 加载器
├── prompts/              # Agent Prompt 模板
├── bus/                  # 🆕 消息总线模块
│   ├── index.ts          # 导出
│   ├── EventBus.ts       # 事件总线
│   ├── MessageQueue.ts   # 消息队列
│   └── LockManager.ts    # 异步锁
├── concurrent/           # 🆕 并发模块
│   ├── index.ts          # 导出
│   ├── ConcurrentAgent.ts    # 并发Agent
│   └── ParallelOrchestrator.ts # 并行执行器
└── test-concurrent.ts    # 并发测试
```

## Agent 角色

| 角色 | 名称 | 职责 |
|------|------|------|
| Agent A | Moderator | 裁判与主持人，控制流程、打分、更新黑板 |
| Agent B | Proposer | 建构者/正方，提出建设性方案 |
| Agent C | Skeptic | 破坏者/反方，找漏洞、攻击边缘情况 |
| Agent D | FactChecker | 查证员，核查事实争议 |
| Agent X | Expert | 动态专家，用户提供背景的专业视角 |

## 工作流

```
Step 1: 立论     → 提出首轮分析
Step 2: 补充 → 基于专业背景补充视角
Step 3: 质询    → 攻击漏洞、提出致命问题
Step 4: 查证 → 核查事实争议（可选）
Step 5: 结算  → 更新黑板、打分、判断是否终止
```

## 使用示例

```typescript
import { DebateOrchestrator } from './multi-agent';

// 创建辩论会话
const debate = DebateOrchestrator.create(
  '2024年普通人是否还适合全职做自媒体？',
  {
    name: '资本大鳄',
    background: '极其看重投资回报率、ROI和商业变现效率的顶级风投家'
  },
  {
    maxRounds: 10,
    terminationScore: 85
  }
);

// 订阅事件
debate.subscribe((event) => {
  console.log(`[${event.type}]`, event.data);
});

// 设置 LLM 调用器
debate.setLLMInvoker(async (prompt, systemPrompt) => {
  // 调用实际的 LLM API
  return await callLLM(prompt, systemPrompt);
});

// 运行辩论
while (debate.getState().status === 'running') {
  await debate.runRound();
}

// 获取最终报告
const blackboard = debate.getBlackboard();
console.log('最终得分:', blackboard.consensusScore);
```

## 全局黑板格式

```json
{
  "round": 1,
  "currentTopic": "当前核心争议点",
  "verifiedFacts": ["经过查证的事实"],
  "coreClashes": ["未解决的分歧"],
  "consensusScore": 75,
  "agentInsights": {
    "Proposer": "建设性观点摘要",
    "Skeptic": "反方观点摘要",
    "Expert": "专家视角摘要"
  },
  "currentStep": "settlement",
  "historySummary": "压缩后的历史摘要"
}
```

## 防爆机制

### 1. 废话零容忍

```typescript
// 自动检测和移除废话
const { hasFluff, cleanContent } = FluffDetector.detectFluff(content);

// 验证格式
const { isValid, issues } = FluffDetector.validateFormat(content);
```

### 2. 状态大于历史

讨论推进的唯一依据是【全局黑板】。如果某个观点未被记录在黑板中，视为已翻篇。

### 3. 强制垃圾回收

每经过 N 轮循环，系统自动折叠之前的对话细节，仅保留最新的黑板状态。

```typescript
if (round % compressionInterval === 0) {
  blackboardManager.compressHistory();
}
```

## 终止条件

- **共识分数 >= 85**：自动终止，输出最终报告
- **达到最大轮次**：强制终止
- **用户干预**：手动停止

## 人工干预

支持在任意时刻注入人工输入：

```typescript
debate.injectHumanInput('反方攻击得不够狠，从政策监管角度再攻击一次', 'skeptic');
```

## 与 Code-Remote 集成

可以作为 subagent 集成到 Code-Remote 中：

```markdown
---
name: debate
description: 多智能体对抗分析引擎，用于深度分析复杂问题
tools: Read, Glob, Grep, WebSearch
---

你是一个多智能体对抗分析引擎的协调器...
```

## 待实现

- [x] 接入真实 LLM API
- [ ] 实现工具调用（搜索、代码执行）
- [ ] 前端 UI 展示
- [ ] WebSocket 实时推送事件
- [ ] 持久化存储

---

## 🆕 并发模式 (v2.0)

### 并行执行

传统模式：Agent串行执行，总耗时 = AgentA + AgentB + AgentC

```
串行: [AgentA] → [AgentB] → [AgentC]  总耗时: 30s
```

并发模式：Agent并行执行，总耗时 ≈ max(AgentA, AgentB, AgentC)

```
并行: [AgentA]
      [AgentB]    总耗时: 10s
      [AgentC]
```

### 使用示例

```typescript
import { ParallelOrchestrator, EventBus } from './multi-agent';
import { ProposerAgent, SkepticAgent } from './multi-agent';

// 创建事件总线
const eventBus = new EventBus();

// 创建并行执行器
const orchestrator = createParallelOrchestrator('如何设计高并发系统？', {
  maxRounds: 5,
  parallelTimeout: 60000  // 单Agent超时60s
});

// 注册Agent
orchestrator.registerAgent('proposer', new ProposerAgent());
orchestrator.registerAgent('skeptic', new SkepticAgent());

// 订阅事件
orchestrator.subscribe((event) => {
  if (event.type === 'round_complete') {
    console.log(`轮次完成: 成功${event.data.successCount} 失败${event.data.failureCount}`);
  }
});

// 运行并行辩论
const result = await orchestrator.runDebateRound();
console.log(`总耗时: ${result.totalDuration}ms`);

// 清理
orchestrator.cleanup();
```

### EventBus 消息总线

```typescript
import { EventBus } from './multi-agent';

const bus = new EventBus();

// 注册Agent
const agentId = bus.register('proposer', async (message) => {
  console.log(`收到消息: ${message.payload}`);
  // 处理消息...
  return { type: 'response', payload: '收到' };
});

// 广播消息
await bus.broadcast('system', { content: 'Hello all!' });

// 单播消息
await bus.publish({
  type: 'request',
  from: 'proposer',
  to: 'skeptic',
  payload: { question: '你怎么看？' },
  priority: 'normal'
});

// 请求-响应模式
const response = await bus.request('proposer', 'skeptic', { data: 'test' });

// 主题订阅
bus.subscribe(agentId, ['debate', 'analysis']);
await bus.emit('system', 'debate', { topic: '架构设计' });
```

### 黑板并发安全

```typescript
import { AsyncLock } from './multi-agent';

const lock = new AsyncLock();

// 多Agent并发写入黑板
async function writeToBlackboard(agentId: string, data: any) {
  await lock.acquire();
  try {
    // 安全地更新黑板
    blackboard.update(data);
  } finally {
    lock.release();
  }
}
```

### 性能对比

| 模式 | 3个Agent耗时 | 失败处理 |
|------|-------------|---------|
| 串行 | ~30s | 一个失败全部中断 |
| 并行 | ~10s | 使用Promise.allSettled，单Agent失败不影响其他 |

