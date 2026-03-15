/**
 * Multi-Agent 基础使用示例
 *
 * 展示如何使用多智能体对抗辩论引擎
 */

import {
  DebateOrchestrator,
  EventBus,
  GlobalBlackboardManager,
  ClaudeCLIAdapter
} from '../multi-agent';

// ============================================
// 示例 1: 基础辩论
// ============================================

async function basicDebate() {
  console.log('=== 基础辩论示例 ===\n');

  // 创建辩论会话
  const debate = DebateOrchestrator.create(
    '2024年普通人是否还适合全职做自媒体？',
    {
      name: '资深媒体人',
      background: '拥有15年媒体行业经验，见证过传统媒体到新媒体的转型'
    },
    {
      maxRounds: 5,
      terminationScore: 85
    }
  );

  // 订阅事件
  debate.subscribe((event) => {
    switch (event.type) {
      case 'round_start':
        console.log(`\n🔄 第 ${event.data.round} 轮开始`);
        break;
      case 'speech':
        console.log(`\n💬 [${event.data.agent}] ${event.data.content.substring(0, 100)}...`);
        break;
      case 'round_end':
        console.log(`\n📊 本轮得分: ${event.data.score}`);
        break;
      case 'debate_end':
        console.log(`\n🏆 辩论结束！最终得分: ${event.data.finalScore}`);
        break;
    }
  });

  // 设置 LLM 适配器（使用 Claude CLI）
  const adapter = new ClaudeCLIAdapter({
    sessionsDir: './multi-agent-sessions'
  });
  debate.setLLMAdapter(adapter);

  // 运行辩论
  while (debate.getState().status === 'running') {
    await debate.runRound();
  }

  // 获取最终结果
  const blackboard = debate.getBlackboard();
  console.log('\n📋 最终黑板状态:');
  console.log('- 核心争议点:', blackboard.coreClashes);
  console.log('- 已验证事实:', blackboard.verifiedFacts);
  console.log('- 共识分数:', blackboard.consensusScore);
}

// ============================================
// 示例 2: 使用自定义 LLM 调用器
// ============================================

async function customLLMDebate() {
  console.log('=== 自定义 LLM 调用器示例 ===\n');

  const debate = DebateOrchestrator.create(
    'AI 会不会取代程序员？',
    {
      name: '技术专家',
      background: '资深软件架构师，对 AI 发展有深入研究'
    },
    { maxRounds: 3 }
  );

  // 使用自定义 LLM 调用器
  debate.setLLMInvoker(async (prompt, systemPrompt) => {
    // 这里可以调用任何 LLM API
    console.log('📤 发送 Prompt:', prompt.substring(0, 50) + '...');

    // 模拟 LLM 响应
    return `这是一个模拟的 LLM 响应。

【分析】
关于"${prompt.substring(0, 30)}..."这个问题...

【论点】
1. 第一个观点...
2. 第二个观点...

【结论】
综上所述...`;
  });

  // 运行一轮辩论
  await debate.runRound();
}

// ============================================
// 示例 3: 人工干预
// ============================================

async function debateWithInterruption() {
  console.log('=== 人工干预示例 ===\n');

  const debate = DebateOrchestrator.create(
    '是否应该禁止 AI 生成内容的版权保护？',
    {
      name: '法律专家',
      background: '知识产权律师，专注数字内容领域'
    },
    { maxRounds: 5 }
  );

  debate.setLLMInvoker(async (prompt) => {
    return '这是模拟响应...';
  });

  // 运行第一轮
  await debate.runRound();

  // 人工干预 - 给反方一个提示
  console.log('\n🚨 人工干预: 提示反方从伦理角度攻击');
  debate.injectHumanInput(
    '请从伦理角度分析：如果禁止 AI 内容版权，是否会影响创作者的积极性？',
    'skeptic'
  );

  // 继续辩论
  await debate.runRound();
}

// ============================================
// 示例 4: 获取中间状态
// ============================================

async function intermediateStates() {
  console.log('=== 中间状态示例 ===\n');

  const debate = DebateOrchestrator.create(
    '远程办公是否会成为主流？',
    { name: 'HR 专家', background: '人力资源管理专家' },
    { maxRounds: 3 }
  );

  debate.setLLMInvoker(async (prompt) => '模拟响应...');

  // 获取初始状态
  console.log('初始状态:', debate.getState());

  // 运行一轮
  await debate.runRound();

  // 获取黑板状态
  const blackboard = debate.getBlackboard();
  console.log('\n第 1 轮后黑板:');
  console.log('- 当前主题:', blackboard.currentTopic);
  console.log('- 已验证事实:', blackboard.verifiedFacts);
  console.log('- 核心争议:', blackboard.coreClashes);
  console.log('- 共识分数:', blackboard.consensusScore);

  // 获取历史发言
  const speeches = debate.getSpeeches();
  console.log('\n历史发言数:', speeches.length);
}

// ============================================
// 示例 5: 导出辩论报告
// ============================================

async function exportDebateReport() {
  console.log('=== 导出报告示例 ===\n');

  const debate = DebateOrchestrator.create(
    '高房价是否阻碍了年轻人的发展？',
    { name: '经济学家', background: '专注于城市经济学研究' },
    { maxRounds: 2 }
  );

  debate.setLLMInvoker(async (prompt) => '模拟响应...');

  // 运行完整辩论
  while (debate.getState().status === 'running') {
    await debate.runRound();
  }

  // 导出报告
  const report = debate.exportReport();
  console.log('\n📄 辩论报告:');
  console.log(report);
}

// ============================================
// 运行示例
// ============================================

async function main() {
  // 选择要运行的示例
  const example = process.argv[2] || 'basic';

  switch (example) {
    case 'basic':
      await basicDebate();
      break;
    case 'custom':
      await customLLMDebate();
      break;
    case 'interrupt':
      await debateWithInterruption();
      break;
    case 'states':
      await intermediateStates();
      break;
    case 'export':
      await exportDebateReport();
      break;
    default:
      console.log('用法: npx tsx basic-debate.ts [basic|custom|interrupt|states|export]');
  }
}

main().catch(console.error);
