/**
 * 恢复会话继续讨论
 *
 * 从保存的会话文件恢复，继续之前中断的讨论
 */

import {
  DebateOrchestrator,
  ClaudeCLIAdapter,
  TokenUsage
} from './index';
import * as path from 'path';
import * as fs from 'fs';

// 恢复之前的辩论会话
const sessionsDir = path.resolve(__dirname, '../../../multi-agent-sessions');

// 查找最新的辩论状态文件
function findLatestDebateState(): { debateFile: string; stateFile: string } | null {
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  // 查找状态文件 (*_state.json)
  const stateFiles = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('_state.json'))
    .sort()
    .reverse();

  if (stateFiles.length === 0) {
    return null;
  }

  const stateFile = path.join(sessionsDir, stateFiles[0]);
  const debateId = stateFiles[0].replace('_state.json', '');
  const debateFile = path.join(sessionsDir, `${debateId}.json`);

  return { debateFile, stateFile };
}

async function continueDebate() {
  console.log('='.repeat(60));
  console.log('恢复会话继续讨论');
  console.log('='.repeat(60));

  // 查找最新辩论状态
  const files = findLatestDebateState();

  if (!files) {
    console.log('❌ 未找到保存的辩论状态文件，开始新讨论...');
    await startNewDebate();
    return;
  }

  const { debateFile, stateFile } = files;

  console.log(`\n📁 加载辩论状态: ${stateFile}`);

  // 读取辩论状态
  const stateData = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  console.log(`📋 辩论 ID: ${stateData.debateSessionId}`);
  console.log(`📊 已完成轮次: ${stateData.round}`);
  console.log(`📅 保存时间: ${stateData.savedAt}`);

  // 读取 LLM 会话数据
  if (fs.existsSync(debateFile)) {
    const debateData = JSON.parse(fs.readFileSync(debateFile, 'utf-8'));
    console.log(`💾 已保存会话:`);
    for (const [role, sessionId] of Object.entries(debateData.sessions || {})) {
      console.log(`   ${role}: ${(sessionId as string).substring(0, 12)}...`);
    }
  }

  // 恢复辩论会话
  const debate = DebateOrchestrator.restore(stateData.debateState);
  console.log(`\n📋 辩论状态已恢复: ${debate.getState().status}`);
  console.log(`   当前轮次: ${debate.getBlackboard().round}`);
  console.log(`   共识分数: ${debate.getBlackboard().consensusScore}/100`);

  // 创建适配器（使用相同的 debateSessionId）
  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir,
    debateSessionId: stateData.debateSessionId
  });

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
        console.log(speech.content.substring(0, 500) + (speech.content.length > 500 ? '...' : ''));
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
        // 每轮完成后保存状态
        saveDebateState(stateData.debateSessionId, (event.data as any).round, debate);
        break;

      case 'debate_complete':
        console.log(`\n🎉 辩论结束！`);
        break;
    }
  });

  console.log('\n🚀 继续讨论...\n');

  // 运行辩论
  let round = stateData.round;
  const maxRounds = 10;

  while (debate.getState().status === 'running' && round < maxRounds) {
    round++;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`第 ${round} 轮`);
    console.log('═'.repeat(60));

    await debate.runRound();
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

  console.log('\n📋 会话持久化:');
  console.log(`  辩论 ID: ${adapter.getDebateSessionId()}`);
  console.log(`  存储文件: ${adapter.getSessionsFile()}`);
  console.log('\n  各角色会话:');
  const sessions = adapter.getAllSessions();
  for (const { role, sessionId } of sessions) {
    console.log(`    ${role}: ${sessionId.substring(0, 12)}...`);
  }

  console.log('\n💰 费用估算 (参考 Claude 3.5 Sonnet):');
  const inputCost = (finalUsage.inputTokens / 1000000) * 3;
  const outputCost = (finalUsage.outputTokens / 1000000) * 15;
  const totalCost = inputCost + outputCost;
  console.log(`  输入费用: $${inputCost.toFixed(6)}`);
  console.log(`  输出费用: $${outputCost.toFixed(6)}`);
  console.log(`  总费用: $${totalCost.toFixed(6)}`);

  return finalUsage;
}

// 保存辩论状态
function saveDebateState(debateSessionId: string, round: number, debate: DebateOrchestrator) {
  const stateFile = path.join(sessionsDir, `${debateSessionId}_state.json`);
  const state = {
    debateSessionId,
    round,
    debateState: debate.exportState(),
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`  💾 辩论状态已保存到: ${stateFile}`);
}

async function startNewDebate() {
  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir
  });

  const debate = DebateOrchestrator.create(
    '如何设计一个多Agent同时沟通协作的AI系统？请给出技术架构方案。',
    {
      name: '系统架构师',
      background: '精通分布式系统、消息队列、事件驱动架构，有大规模微服务架构经验'
    },
    {
      maxRounds: 10,
      terminationScore: 75,
      compressHistory: true,
      compressionInterval: 2
    }
  );

  debate.setLLMAdapter(adapter);

  debate.subscribe((event) => {
    if (event.type === 'blackboard_update') {
      const board = event.data as any;
      console.log(`📊 Round ${board.round}: 分数 ${board.consensusScore}/100`);
    }
  });

  let round = 0;
  while (debate.getState().status === 'running' && round < 10) {
    round++;
    console.log(`\n=== 第 ${round} 轮 ===`);
    await debate.runRound();
    saveDebateState(adapter.getDebateSessionId(), round, debate);
  }

  console.log('\n✅ 讨论完成');
}

// 运行
continueDebate()
  .then(() => {
    console.log('\n' + '='.repeat(60));
    console.log('✅ 完成');
    console.log('='.repeat(60));
  })
  .catch((error) => {
    console.error('\n❌ 失败:', error.message);
    process.exit(1);
  });
