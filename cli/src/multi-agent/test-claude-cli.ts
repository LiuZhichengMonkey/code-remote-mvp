/**
 * Claude CLI 测试
 *
 * 使用 Claude CLI 进行多智能体辩论测试
 * 统计 token 消耗（估算值）
 *
 * 特性：
 * - 会话复用：每个 Agent 角色维护独立会话，避免重复发送系统提示词
 * - 增量上下文：后续调用只发送增量信息，节省 token
 * - 会话持久化：会话元数据保存到文件，可跨进程复用
 */

import {
  DebateOrchestrator,
  ClaudeCLIAdapter,
  TokenUsage
} from './index';
import * as path from 'path';
import * as fs from 'fs';

async function runClaudeCLITest() {
  console.log('='.repeat(60));
  console.log('Claude CLI 多智能体测试 - 会话复用版');
  console.log('='.repeat(60));
  console.log('\n✨ 特性:');
  console.log('  - 每个 Agent 角色维护独立会话');
  console.log('  - 后续调用只发送增量上下文');
  console.log('  - 会话持久化到文件，可跨进程复用');
  console.log('  - 预计节省 30-50% token');

  // 创建 Claude CLI 适配器（会话保存在 multi-agent-sessions 目录）
  const sessionsDir = path.resolve(__dirname, '../../../multi-agent-sessions');
  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir
  });

  console.log(`\n📁 会话存储目录: ${sessionsDir}`);
  console.log(`📋 辩论会话 ID: ${adapter.getDebateSessionId()}`);

  // 创建辩论会话
  const debate = DebateOrchestrator.create(
    '如何设计一个多Agent同时沟通协作的AI系统？请给出技术架构方案。',
    {
      name: '系统架构师',
      background: '精通分布式系统、消息队列、事件驱动架构，有大规模微服务架构经验，关注系统的可扩展性、一致性和容错性'
    },
    {
      maxRounds: 10,
      terminationScore: 85,
      compressHistory: true,
      compressionInterval: 2
    }
  );

  // 设置 LLM 适配器
  debate.setLLMAdapter(adapter);

  // 订阅事件
  debate.subscribe((event) => {
    switch (event.type) {
      case 'speech':
        const speech = event.data as any;
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`[${speech.role}] ${speech.agentName}:`);
        console.log('─'.repeat(50));
        console.log(speech.content);
        break;

      case 'blackboard_update':
        const board = event.data as any;
        console.log(`\n📊 黑板更新 (Round ${board.round}):`);
        console.log(`   共识分数: ${board.consensusScore}/100`);
        const usage = debate.getTokenUsage();
        console.log(`   Token: 输入 ${usage.inputTokens} | 输出 ${usage.outputTokens} | 总计 ${usage.totalTokens}`);
        break;

      case 'round_complete':
        console.log(`\n✅ 第 ${(event.data as any).round} 轮完成`);
        break;

      case 'debate_complete':
        console.log(`\n🎉 辩论结束！`);
        break;
    }
  });

  console.log('\n📋 辩论配置:');
  console.log(`   议题: ${debate.getState().originalQuestion}`);
  console.log(`   自定义专家: ${debate.getState().customExpert?.name}`);
  console.log(`   最大轮次: 10`);

  console.log('\n🚀 开始辩论...\n');

  // 运行辩论
  let round = 0;
  const maxRounds = 10;

  // 每轮后保存辩论状态
  const saveDebateState = () => {
    const stateFile = path.join(sessionsDir, `${adapter.getDebateSessionId()}_state.json`);
    const state = {
      debateSessionId: adapter.getDebateSessionId(),
      round,
      debateState: debate.exportState(),
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    console.log(`  💾 辩论状态已保存到: ${stateFile}`);
  };

  while (debate.getState().status === 'running' && round < maxRounds) {
    round++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`第 ${round} 轮`);
    console.log('═'.repeat(60));

    await debate.runRound();

    // 每轮结束后保存状态
    saveDebateState();
  }

  // 最终统计
  console.log('\n' + '='.repeat(60));
  console.log('Token 消耗统计报告');
  console.log('='.repeat(60));

  const finalUsage = debate.getTokenUsage();

  console.log('\n📊 总体统计:');
  console.log(`  总输入 Token: ${finalUsage.inputTokens}`);
  console.log(`  总输出 Token: ${finalUsage.outputTokens}`);
  console.log(`  总 Token: ${finalUsage.totalTokens}`);
  console.log(`  API 调用次数: ${finalUsage.requests}`);
  console.log(`  辩论轮次: ${round}`);

  // 显示会话持久化信息
  console.log('\n📋 会话持久化:');
  console.log(`  辩论 ID: ${adapter.getDebateSessionId()}`);
  console.log(`  存储文件: ${adapter.getSessionsFile()}`);
  console.log('\n  各角色会话:');
  const sessions = adapter.getAllSessions();
  for (const { role, sessionId } of sessions) {
    console.log(`    ${role}: ${sessionId.substring(0, 12)}...`);
  }

  console.log('\n📋 按角色统计:');
  const byRole = finalUsage.byRole;
  const roleNames: Record<string, string> = {
    'proposer': '建构者',
    'skeptic': '破坏者',
    'expert': '专家',
    'moderator': '主持人',
    'fact-checker': '查证员'
  };

  for (const [role, usage] of byRole) {
    const name = roleNames[role] || role;
    console.log(`  ${name} (${role}):`);
    console.log(`    输入: ${usage.inputTokens} | 输出: ${usage.outputTokens} | 调用: ${usage.requests}`);
  }

  // 费用估算
  console.log('\n💰 费用估算 (参考 Claude 3.5 Sonnet):');
  const inputCost = (finalUsage.inputTokens / 1000000) * 3;
  const outputCost = (finalUsage.outputTokens / 1000000) * 15;
  const totalCost = inputCost + outputCost;
  console.log(`  输入费用: $${inputCost.toFixed(6)}`);
  console.log(`  输出费用: $${outputCost.toFixed(6)}`);
  console.log(`  总费用: $${totalCost.toFixed(6)}`);

  console.log('\n📝 最终黑板状态:');
  const finalBoard = debate.getBlackboard();
  console.log(JSON.stringify(finalBoard, null, 2));

  console.log('\n💡 提示: 会话已保存，下次运行时可以恢复之前的辩论上下文');

  return finalUsage;
}

// 运行测试
runClaudeCLITest()
  .then((usage) => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ 测试完成');
    console.log('='.repeat(60));
  })
  .catch((error) => {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  });
