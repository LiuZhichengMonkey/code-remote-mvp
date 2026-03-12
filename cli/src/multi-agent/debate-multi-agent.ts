/**
 * 辩论议题：设计多Agent同时沟通的AI系统
 */

import {
  DebateOrchestrator,
  ClaudeCLIAdapter
} from './index';

async function debateMultiAgentSystem() {
  console.log('='.repeat(70));
  console.log('多智能体对抗辩论');
  console.log('='.repeat(70));

  // 创建 Claude CLI 适配器
  const adapter = new ClaudeCLIAdapter({ maxTokens: 2048 });

  // 创建辩论会话
  const debate = DebateOrchestrator.create(
    '如何设计一个多Agent同时沟通协作的AI系统？请给出技术架构方案。',
    {
      name: '系统架构师',
      background: '精通分布式系统、消息队列、事件驱动架构，有大规模微服务架构经验，关注系统的可扩展性、一致性和容错性'
    },
    {
      maxRounds: 10,           // 最多10轮
      terminationScore: 85,    // 达到85分终止
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
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📢 [${speech.role}] ${speech.agentName}:`);
        console.log('─'.repeat(60));
        console.log(speech.content);
        break;

      case 'blackboard_update':
        const board = event.data as any;
        console.log(`\n📊 黑板更新 (Round ${board.round}):`);
        console.log(`   共识分数: ${board.consensusScore}/100`);
        const usage = debate.getTokenUsage();
        console.log(`   Token: 输入 ${usage.inputTokens} | 输出 ${usage.outputTokens}`);
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
  console.log(`   专家背景: ${debate.getState().customExpert?.background}`);
  console.log(`   最大轮次: 10`);
  console.log(`   终止分数: 85`);

  console.log('\n🚀 开始辩论...\n');

  // 运行辩论
  let round = 0;
  while (debate.getState().status === 'running' && round < 10) {
    round++;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`第 ${round} 轮`);
    console.log('═'.repeat(70));

    await debate.runRound();
  }

  // 最终统计
  console.log('\n' + '='.repeat(70));
  console.log('最终方案报告');
  console.log('='.repeat(70));

  const finalUsage = debate.getTokenUsage();
  const finalBoard = debate.getBlackboard();

  console.log('\n📊 Token 消耗统计:');
  console.log(`   总输入: ${finalUsage.inputTokens} | 总输出: ${finalUsage.outputTokens}`);
  console.log(`   总 Token: ${finalUsage.totalTokens}`);
  console.log(`   API 调用: ${finalUsage.requests} 次`);
  console.log(`   实际轮次: ${round}`);

  console.log('\n📋 各角色贡献:');
  const roleNames: Record<string, string> = {
    'proposer': '建构者',
    'skeptic': '破坏者',
    'expert': '系统架构师',
    'moderator': '主持人'
  };
  for (const [role, usage] of finalUsage.byRole) {
    const name = roleNames[role] || role;
    console.log(`   ${name}: 输入 ${usage.inputTokens} | 输出 ${usage.outputTokens} | ${usage.requests}次`);
  }

  console.log('\n💡 共识分数:', finalBoard.consensusScore);

  console.log('\n📝 最终见解汇总:');
  for (const [role, insight] of Object.entries(finalBoard.agentInsights)) {
    const name = roleNames[role] || role;
    console.log(`\n【${name}】`);
    console.log((insight as string).substring(0, 500) + '...');
  }

  return { finalBoard, finalUsage, round };
}

// 运行
debateMultiAgentSystem()
  .then(({ finalBoard, finalUsage, round }) => {
    console.log('\n' + '='.repeat(70));
    console.log('✅ 辩论完成');
    console.log('='.repeat(70));
  })
  .catch((error) => {
    console.error('\n❌ 辩论失败:', error);
    process.exit(1);
  });
