/**
 * 多智能体对抗引擎测试
 */

import {
  DebateOrchestrator,
  MockLLMAdapter,
  BlackboardManager,
  AgentFactory,
  FluffDetector
} from './index';

// 设置不同角色的模拟回复
function setupMockResponses(mockAdapter: MockLLMAdapter) {
  // 建构者回复
  mockAdapter.setResponse('proposer', `## 建构方观点

- 核心方案: 自媒体仍有机会，但需要差异化定位
- 关键优势: 门槛低、传播快、变现渠道多样
- 行动建议: 选择垂直细分领域，建立个人品牌`);

  // 反方回复
  mockAdapter.setResponse('skeptic', `## 反方质询

### 致命问题
1. 平台算法变化导致流量不稳定，如何保证持续收入？
2. 同质化竞争激烈，如何建立真正的差异化？

### 潜在风险
- 政策监管趋严，部分领域面临封禁风险
- AI 内容生成降低门槛，竞争将进一步加剧`);

  // 专家回复
  mockAdapter.setResponse('资本大鳄', `## 资本大鳄视角

- ROI 角度: 单个账号变现效率低，需要矩阵运营
- 风险评估: 头部效应明显，80% 流量集中在 20% 账号
- 投资考量: 更倾向于投资内容团队而非个人创作者`);

  // 主持人回复
  mockAdapter.setResponse('moderator', `## 结算报告

### 当前状态
- 核心议题: 2024年普通人是否适合全职自媒体
- 已验证事实: 2 条
- 待解决争议: 2 个

### 评分
- 逻辑严密性: 20/30
- 漏洞修复: 15/30
- 实际价值: 25/40
- **总分: 60/100**

⏳ 继续下一轮讨论`);
}

async function runDebateTest() {
  console.log('='.repeat(60));
  console.log('多智能体对抗引擎测试');
  console.log('='.repeat(60));

  // 创建 Mock 适配器
  const mockAdapter = new MockLLMAdapter();
  setupMockResponses(mockAdapter);

  // 创建辩论会话
  const debate = DebateOrchestrator.create(
    '2024年普通人是否还适合全职做自媒体？',
    {
      name: '资本大鳄',
      background: '极其看重投资回报率、ROI和商业变现效率的顶级风投家'
    },
    {
      maxRounds: 3,
      terminationScore: 85,
      compressHistory: true,
      compressionInterval: 2
    }
  );

  // 设置 LLM 适配器
  debate.setLLMAdapter(mockAdapter);

  // 订阅事件
  debate.subscribe((event) => {
    switch (event.type) {
      case 'speech':
        const speech = event.data as any;
        console.log(`\n[${speech.role}] ${speech.agentName}:`);
        console.log(speech.content.substring(0, 200) + '...');
        break;

      case 'blackboard_update':
        const board = event.data as any;
        console.log(`\n📊 黑板更新 (Round ${board.round}):`);
        console.log(`   共识分数: ${board.consensusScore}/100`);
        console.log(`   待解决争议: ${board.coreClashes.length} 个`);
        break;

      case 'round_complete':
        console.log(`\n✅ 第 ${(event.data as any).round} 轮完成`);
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
  while (debate.getState().status === 'running' && round < 3) {
    round++;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`第 ${round} 轮`);
    console.log('='.repeat(50));

    await debate.runRound();
  }

  // 输出最终结果
  const finalBoard = debate.getBlackboard();
  console.log('\n' + '='.repeat(60));
  console.log('最终结果');
  console.log('='.repeat(60));
  console.log(JSON.stringify(finalBoard, null, 2));

  return finalBoard;
}

// 测试防爆机制
function testFluffDetector() {
  console.log('\n' + '='.repeat(60));
  console.log('防爆机制测试');
  console.log('='.repeat(60));

  const testCases = [
    '作为正方我认为这个方案可行。',
    '我觉得这个问题很复杂。',
    '首先，我们需要分析问题；其次，我们需要找到解决方案。',
    '- 核心方案明确\n- 执行路径清晰\n- 风险可控'
  ];

  for (const content of testCases) {
    const result = FluffDetector.detectFluff(content);
    const validation = FluffDetector.validateFormat(content);

    console.log(`\n原文: "${content}"`);
    console.log(`  废话检测: ${result.hasFluff ? '⚠️ 有废话' : '✅ 无废话'}`);
    console.log(`  格式验证: ${validation.isValid ? '✅ 通过' : '❌ 未通过'}`);
    if (!validation.isValid) {
      console.log(`  问题: ${validation.issues.join(', ')}`);
    }
  }
}

// 测试黑板管理
function testBlackboard() {
  console.log('\n' + '='.repeat(60));
  console.log('黑板管理测试');
  console.log('='.repeat(60));

  const blackboard = BlackboardManager.create('测试议题');

  console.log('\n初始状态:');
  console.log(JSON.stringify(blackboard.getState(), null, 2));

  blackboard.addVerifiedFact('事实1: 市场规模达到100亿');
  blackboard.addVerifiedFact('事实2: 用户增长率为20%');
  blackboard.addClash('争议1: 竞争是否过于激烈');
  blackboard.updateAgentInsight('Proposer', '机会大于风险');
  blackboard.updateAgentInsight('Skeptic', '风险被低估');
  blackboard.updateScore(65);

  console.log('\n更新后状态:');
  console.log(JSON.stringify(blackboard.getState(), null, 2));

  // 测试历史压缩
  blackboard.recordSpeech({
    agentName: 'Proposer',
    role: 'proposer',
    content: '这是一个很长的发言内容，需要被压缩保存。',
    timestamp: Date.now(),
    round: 1,
    step: 'proposer'
  });

  const summary = blackboard.compressHistory();
  console.log('\n压缩后历史摘要:');
  console.log(summary);
}

// 运行所有测试
async function main() {
  try {
    // 测试黑板
    testBlackboard();

    // 测试防爆
    testFluffDetector();

    // 测试完整辩论流程
    await runDebateTest();

    console.log('\n✅ 所有测试完成');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

// 导出测试函数
export { runDebateTest, testFluffDetector, testBlackboard };

// 如果直接运行此文件
if (require.main === module) {
  main();
}
