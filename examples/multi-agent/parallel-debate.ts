/**
 * 并行辩论示例
 *
 * 展示如何使用 ParallelOrchestrator 并行执行多个 Agent
 */

import {
  ParallelOrchestrator,
  EventBus,
  createParallelOrchestrator
} from '../multi-agent';

// ============================================
// 示例 1: 基础并行辩论
// ============================================

async function basicParallelDebate() {
  console.log('=== 基础并行辩论示例 ===\n');

  // 创建并行执行器
  const orchestrator = createParallelOrchestrator(
    '如何设计一个高并发系统？',
    {
      maxRounds: 3,
      parallelTimeout: 60000 // 每个 Agent 超时 60 秒
    }
  );

  // 订阅事件
  orchestrator.subscribe((event) => {
    switch (event.type) {
      case 'agent_response':
        console.log(`[${event.data.agent}] ${event.data.content.substring(0, 50)}...`);
        break;
      case 'round_complete':
        console.log(`\n✅ 轮次完成: 成功 ${event.data.successCount}, 失败 ${event.data.failureCount}`);
        console.log(`⏱️ 总耗时: ${event.data.duration}ms\n`);
        break;
      case 'debate_complete':
        console.log('🏆 辩论完成！');
        console.log('最终黑板:', event.data.blackboard);
        break;
      case 'error':
        console.error('❌ 错误:', event.data.error);
        break;
    }
  });

  // 设置 LLM 调用器
  orchestrator.setLLMInvoker(async (prompt, systemPrompt) => {
    // 模拟 LLM 延迟
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    return `这是对 "${prompt.substring(0, 30)}..." 的响应。\n\n【分析】\n这是模拟的 LLM 响应内容...`;
  });

  // 运行辩论
  try {
    const result = await orchestrator.runDebate();
    console.log('\n📊 最终结果:');
    console.log('- 状态:', result.status);
    console.log('- 轮次:', result.rounds);
    console.log('- 总耗时:', result.totalDuration, 'ms');
  } catch (error) {
    console.error('辩论失败:', error);
  }

  // 清理
  orchestrator.cleanup();
}

// ============================================
// 示例 2: 对比串行 vs 并行
// ============================================

async function compareSerialVsParallel() {
  console.log('=== 串行 vs 并行对比 ===\n');

  const topic = '微服务架构是否适合初创公司？';
  const agentCount = 3;

  // 模拟 LLM 延迟
  const mockLLM = async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return '模拟响应...';
  };

  // 串行执行
  console.log('🐌 串行执行:');
  const serialStart = Date.now();
  for (let i = 0; i < agentCount; i++) {
    await mockLLM();
    console.log(`  Agent ${i + 1} 完成`);
  }
  const serialTime = Date.now() - serialStart;
  console.log(`  总耗时: ${serialTime}ms\n`);

  // 并行执行
  console.log('🚀 并行执行:');
  const orchestrator = createParallelOrchestrator(topic, {
    maxRounds: 1,
    parallelTimeout: 30000
  });
  orchestrator.setLLMInvoker(mockLLM);

  const parallelStart = Date.now();
  await orchestrator.runDebateRound();
  const parallelTime = Date.now() - parallelStart;
  console.log(`  总耗时: ${parallelTime}ms\n`);

  // 对比
  console.log('📊 对比结果:');
  console.log(`  串行: ${serialTime}ms`);
  console.log(`  并行: ${parallelTime}ms`);
  console.log(`  提升: ${((serialTime - parallelTime) / serialTime * 100).toFixed(1)}%`);

  orchestrator.cleanup();
}

// ============================================
// 示例 3: 带超时和错误处理的并行辩论
// ============================================

async function parallelWithTimeout() {
  console.log('=== 带超时和错误处理的并行辩论 ===\n');

  const orchestrator = createParallelOrchestrator(
    '区块链技术在金融领域的应用前景如何？',
    {
      maxRounds: 2,
      parallelTimeout: 3000 // 短超时用于演示
    }
  );

  // 模拟一些 Agent 会超时
  orchestrator.setLLMInvoker(async (prompt, systemPrompt) => {
    const delay = Math.random() * 5000;
    console.log(`  LLM 调用延迟: ${delay.toFixed(0)}ms`);

    if (delay > 3000) {
      console.log('  ⚠️ 即将超时...');
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    return '响应内容...';
  });

  // 错误处理
  orchestrator.subscribe((event) => {
    if (event.type === 'error') {
      console.log(`❌ Agent ${event.data.agent} 失败: ${event.data.error}`);
    }
    if (event.type === 'agent_response') {
      console.log(`✅ Agent ${event.data.agent} 成功`);
    }
  });

  // 运行并处理结果
  const result = await orchestrator.runDebate();

  console.log('\n📊 结果统计:');
  console.log('- 完成状态:', result.status);
  console.log('- 错误数:', result.errors?.length || 0);

  orchestrator.cleanup();
}

// ============================================
// 示例 4: 多轮并行辩论
// ============================================

async function multiRoundParallelDebate() {
  console.log('=== 多轮并行辩论示例 ===\n');

  const orchestrator = createParallelOrchestrator(
    '远程办公是否会成为未来的主流工作模式？',
    {
      maxRounds: 5,
      terminationScore: 85,
      parallelTimeout: 10000
    }
  );

  let roundCount = 0;

  orchestrator.subscribe((event) => {
    if (event.type === 'round_complete') {
      roundCount++;
      console.log(`\n━━━ 第 ${roundCount} 轮完成 ━━━`);
      console.log(`  共识分数: ${event.data.blackboard?.consensusScore || 'N/A'}`);
      console.log(`  成功: ${event.data.successCount}, 失败: ${event.data.failureCount}`);
    }
  });

  orchestrator.setLLMInvoker(async (prompt) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return '模拟响应...';
  });

  // 运行直到终止条件
  const result = await orchestrator.runDebate();

  console.log('\n🏆 最终结果:');
  console.log('- 总轮次:', result.rounds);
  console.log('- 最终分数:', result.blackboard?.consensusScore);
  console.log('- 终止原因:', result.status);

  orchestrator.cleanup();
}

// ============================================
// 示例 5: 自定义 Agent 配置
// ============================================

async function customAgentConfiguration() {
  console.log('=== 自定义 Agent 配置示例 ===\n');

  const eventBus = new EventBus();

  // 自定义 Agent 配置
  const agents = [
    {
      role: 'proposer' as const,
      name: '支持者',
      systemPrompt: '你是正方，请提出支持的观点...',
      handler: async (message: any) => {
        console.log('[支持者] 处理中...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { content: '支持的观点...' };
      }
    },
    {
      role: 'skeptic' as const,
      name: '质疑者',
      systemPrompt: '你是反方，请提出反对的观点...',
      handler: async (message: any) => {
        console.log('[质疑者] 处理中...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        return { content: '反对的观点...' };
      }
    },
    {
      role: 'fact-checker' as const,
      name: '查证员',
      systemPrompt: '你是查证员，请验证事实...',
      handler: async (message: any) => {
        console.log('[查证员] 处理中...');
        await new Promise(resolve => setTimeout(resolve, 800));
        return { content: '验证结果...' };
      }
    }
  ];

  // 注册所有 Agent
  agents.forEach(agent => {
    eventBus.register(agent.role, agent.handler);
    console.log(`✅ 已注册: ${agent.name}`);
  });

  // 并行触发所有 Agent
  console.log('\n🚀 并行执行所有 Agent...\n');
  const startTime = Date.now();

  const results = await Promise.allSettled(
    agents.map(agent =>
      eventBus.request('moderator', agent.role, { topic: '测试话题' }, 5000)
    )
  );

  const duration = Date.now() - startTime;
  console.log(`\n⏱️ 并行执行耗时: ${duration}ms`);

  // 统计结果
  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected').length;
  console.log(`📊 成功: ${fulfilled}, 失败: ${rejected}`);
}

// ============================================
// 运行示例
// ============================================

async function main() {
  const example = process.argv[2] || 'basic';

  switch (example) {
    case 'basic':
      await basicParallelDebate();
      break;
    case 'compare':
      await compareSerialVsParallel();
      break;
    case 'timeout':
      await parallelWithTimeout();
      break;
    case 'multiround':
      await multiRoundParallelDebate();
      break;
    case 'custom':
      await customAgentConfiguration();
      break;
    default:
      console.log('用法: npx tsx parallel-debate.ts [basic|compare|timeout|multiround|custom]');
  }
}

main().catch(console.error);
