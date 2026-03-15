/**
 * 功能需求讨论测试
 *
 * 测试议题：Code-Remote 多智能体讨论功能
 */

import {
  DebateOrchestrator,
  ClaudeCLIAdapter
} from './index';
import * as path from 'path';
import * as fs from 'fs';

async function runFeatureDiscussion() {
  console.log('='.repeat(70));
  console.log('🤖 多智能体功能讨论测试');
  console.log('='.repeat(70));

  // 议题：用户提出的功能需求
  const topic = `功能需求：在 Code-Remote 中添加多智能体讨论功能

需求描述：
- 用户可以通过 @多个智能体 进行讨论
- 智能体的个数根据用户选择来确定
- 用户指派任务，智能体回复
- 最终输出到一个界面上，显示讨论的过程和结果

请分析这个功能的：
1. 技术可行性和实现方案
2. 用户交互设计
3. 潜在的技术挑战
4. 最佳实践建议`;

  // 创建会话目录
  const sessionsDir = path.resolve(__dirname, '../../../multi-agent-sessions');
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }

  // 创建 Claude CLI 适配器
  const adapter = new ClaudeCLIAdapter({
    maxTokens: 2048,
    sessionsDir
  });

  // 创建辩论会话，指定一个产品经理作为专家
  const debate = DebateOrchestrator.create(
    topic,
    {
      name: '产品经理',
      background: `资深产品经理，专注于开发者工具和 AI 产品。
擅长用户体验设计、需求分析、产品规划。
关注功能的实用性和用户价值，善于平衡技术复杂度与用户体验。`
    },
    {
      maxRounds: 5,  // 5轮讨论
      terminationScore: 90,
      compressHistory: true,
      compressionInterval: 2,
      enableFactChecker: false  // 纯讨论，不需要事实核查
    }
  );

  // 设置 LLM 适配器
  debate.setLLMAdapter(adapter);

  // 订阅事件
  let debateCompleted = false;
  debate.subscribe((event) => {
    switch (event.type) {
      case 'speech':
        const speech = event.data as any;
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🎤 [${speech.role}] ${speech.agentName}:`);
        console.log('─'.repeat(60));
        console.log(speech.content);
        break;

      case 'blackboard_update':
        const board = event.data as any;
        console.log(`\n📊 状态更新 (Round ${board.round}):`);
        console.log(`   共识分数: ${board.consensusScore}/100`);
        const usage = debate.getTokenUsage();
        console.log(`   Token: 输入 ${usage.inputTokens} | 输出 ${usage.outputTokens}`);
        break;

      case 'debate_complete':
        console.log(`\n🎉 讨论结束！`);
        debateCompleted = true;
        break;
    }
  });

  console.log('\n📋 讨论配置:');
  console.log(`   议题: ${topic.substring(0, 50)}...`);
  console.log(`   自定义专家: 产品经理`);
  console.log(`   最大轮次: 5`);

  console.log('\n🚀 开始讨论...\n');

  // 运行讨论
  let round = 0;
  const maxRounds = 5;

  while (debate.getState().status === 'running' && round < maxRounds) {
    round++;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`第 ${round} 轮讨论`);
    console.log('═'.repeat(70));

    await debate.runRound();
  }

  // 输出最终报告
  console.log('\n' + '='.repeat(70));
  console.log('📋 讨论总结');
  console.log('='.repeat(70));

  const finalState = debate.getState();
  console.log(`\n📊 最终状态:`);
  console.log(`   状态: ${finalState.status}`);
  console.log(`   轮次: ${finalState.blackboard.round}`);
  console.log(`   共识分数: ${finalState.blackboard.consensusScore}/100`);

  if (finalState.blackboard.verifiedFacts.length > 0) {
    console.log(`\n✅ 确认的要点:`);
    for (const fact of finalState.blackboard.verifiedFacts) {
      console.log(`   - ${fact}`);
    }
  }

  if (finalState.blackboard.coreClashes.length > 0) {
    console.log(`\n⚠️ 待讨论的问题:`);
    for (const clash of finalState.blackboard.coreClashes) {
      console.log(`   - ${clash}`);
    }
  }

  if (Object.keys(finalState.blackboard.agentInsights).length > 0) {
    console.log(`\n💡 各角色见解:`);
    for (const [agent, insight] of Object.entries(finalState.blackboard.agentInsights)) {
      console.log(`   [${agent}]: ${insight}`);
    }
  }

  // Token 统计
  const finalUsage = debate.getTokenUsage();
  console.log('\n📊 Token 消耗:');
  console.log(`   总输入: ${finalUsage.inputTokens}`);
  console.log(`   总输出: ${finalUsage.outputTokens}`);
  console.log(`   总计: ${finalUsage.totalTokens}`);

  // 保存报告
  const reportDir = path.resolve(__dirname, '../../../debate-reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const report = debate.getFinalReport();
  if (report) {
    const reportFile = path.join(reportDir, `feature-discussion-${Date.now()}.md`);
    fs.writeFileSync(reportFile, report.detailedReport || '');
    console.log(`\n📄 详细报告已保存: ${reportFile}`);
  }
}

// 运行测试
runFeatureDiscussion().catch(console.error);
