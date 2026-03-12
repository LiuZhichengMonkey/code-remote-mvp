/**
 * 真实 LLM 测试
 *
 * 使用 GLM-5 或其他 OpenAI 兼容 API 进行测试
 * 统计 token 消耗
 */

import {
  DebateOrchestrator,
  OpenAICompatibleAdapter,
  TokenUsage
} from './index';

// 配置 - 请根据实际情况修改
const LLM_CONFIG = {
  // GLM-5 配置（示例）
  apiKey: process.env.GLM_API_KEY || process.env.OPENAI_API_KEY || '',
  model: process.env.GLM_MODEL || 'glm-5',
  baseUrl: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
};

async function runRealLLMTest() {
  console.log('='.repeat(60));
  console.log('真实 LLM 测试 - Token 消耗统计');
  console.log('='.repeat(60));

  if (!LLM_CONFIG.apiKey) {
    console.error('\n❌ 错误: 请设置环境变量 GLM_API_KEY 或 OPENAI_API_KEY');
    console.log('\n使用方式:');
    console.log('  Windows: set GLM_API_KEY=your_api_key && npx ts-node src/multi-agent/test-real-llm.ts');
    console.log('  Linux/Mac: GLM_API_KEY=your_api_key npx ts-node src/multi-agent/test-real-llm.ts');
    return;
  }

  console.log(`\n配置信息:`);
  console.log(`  模型: ${LLM_CONFIG.model}`);
  console.log(`  API: ${LLM_CONFIG.baseUrl}`);

  // 创建适配器
  const adapter = new OpenAICompatibleAdapter(LLM_CONFIG);

  // 创建辩论会话
  const debate = DebateOrchestrator.create(
    '2024年普通人是否还适合全职做自媒体？',
    {
      name: '资本大鳄',
      background: '极其看重投资回报率、ROI和商业变现效率的顶级风投家'
    },
    {
      maxRounds: 2,  // 只运行2轮以节省 token
      terminationScore: 85,
      compressHistory: true,
      compressionInterval: 1
    }
  );

  // 设置 LLM 适配器
  debate.setLLMAdapter(adapter);

  // 订阅事件
  debate.subscribe((event) => {
    switch (event.type) {
      case 'speech':
        const speech = event.data as any;
        console.log(`\n[${speech.role}] ${speech.agentName}:`);
        console.log(speech.content.substring(0, 300) + (speech.content.length > 300 ? '...' : ''));
        break;

      case 'blackboard_update':
        const board = event.data as any;
        console.log(`\n📊 黑板更新 (Round ${board.round}):`);
        console.log(`   共识分数: ${board.consensusScore}/100`);
        break;

      case 'round_complete':
        console.log(`\n✅ 第 ${(event.data as any).round} 轮完成`);
        // 显示当前 token 使用情况
        const usage = debate.getTokenUsage();
        console.log(`\n💰 Token 使用 (累计):`);
        console.log(`   输入: ${usage.inputTokens} | 输出: ${usage.outputTokens} | 总计: ${usage.totalTokens}`);
        break;

      case 'debate_complete':
        console.log(`\n🎉 辩论结束！`);
        break;
    }
  });

  console.log('\n开始辩论...\n');
  console.log('议题:', debate.getState().originalQuestion);
  console.log('自定义专家:', debate.getState().customExpert);

  // 运行辩论
  let round = 0;
  while (debate.getState().status === 'running' && round < 2) {
    round++;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`第 ${round} 轮`);
    console.log('='.repeat(50));

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

  // 估算费用（以 GLM-4 为例）
  console.log('\n💰 费用估算 (参考 GLM-4 价格):');
  // GLM-4 价格: 输入 0.1元/千tokens, 输出 0.1元/千tokens
  const inputCost = (finalUsage.inputTokens / 1000) * 0.1;
  const outputCost = (finalUsage.outputTokens / 1000) * 0.1;
  const totalCost = inputCost + outputCost;
  console.log(`  输入费用: ¥${inputCost.toFixed(4)}`);
  console.log(`  输出费用: ¥${outputCost.toFixed(4)}`);
  console.log(`  总费用: ¥${totalCost.toFixed(4)}`);

  console.log('\n📝 最终黑板状态:');
  const finalBoard = debate.getBlackboard();
  console.log(JSON.stringify(finalBoard, null, 2));
}

// 运行测试
runRealLLMTest().catch(console.error);
