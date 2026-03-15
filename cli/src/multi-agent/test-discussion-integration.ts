/**
 * 测试讨论系统集成
 *
 * 验证 @语法解析、讨论协调器、WebSocket 通信
 */

import { DiscussionOrchestrator, AgentParser, BUILTIN_TEMPLATES, createDiscussionOrchestrator } from './discussion';

console.log('=== 讨论系统集成测试 ===\n');

// 1. 测试 AgentParser
console.log('1. 测试 AgentParser');
console.log('='.repeat(50));

const parser = new AgentParser();
parser.registerTemplates(BUILTIN_TEMPLATES);

const testInputs = [
  '@代码审查 这个设计是否合理？',
  '@架构师 @测试专家 分析 API 设计',
  '@安全专家 @性能专家 评估性能和安全风险',
  '@不存在的agent 测试无效提及',
  '@代码审查 @架构师 @测试专家 @安全专家 多人讨论'
];

for (const input of testInputs) {
  const mentions = parser.parseUnique(input);
  const templates = parser.parseValidTemplates(input);
  const task = parser.removeMentions(input);
  console.log(`\n输入: "${input}"`);
  console.log(`  有效提及: ${mentions.filter((m: any) => m.valid).length}`);
  console.log(`  匹配模板: ${templates.map((t: any) => t.name).join(', ') || '无'}`);
  console.log(`  任务内容: "${task}"`);
}

// 2. 测试 DiscussionOrchestrator
console.log('\n\n2. 测试 DiscussionOrchestrator');
console.log('='.repeat(50));

const orchestrator = createDiscussionOrchestrator({
  maxRounds: 2,
  messageTimeout: 30000
});

// 订阅事件
orchestrator.subscribe(event => {
  switch (event.type) {
    case 'session_start':
      console.log(`\n[开始] ${event.data}`);
      break;
    case 'agent_activated':
      const participant = event.data as any;
      console.log(`[激活] ${participant.template?.name || 'Agent'}`);
      break;
    case 'message':
      const msg = event.data as any;
      if (msg.type === 'agent') {
        console.log(`\n[${msg.sender}] (${msg.role}):`);
        console.log(`  ${msg.content}`);
      }
      break;
    case 'round_complete':
      console.log(`\n--- ${event.data} ---`);
      break;
    case 'session_end':
      console.log(`\n[完成] 结论已生成`);
      break;
  }
});

// 运行测试讨论
const testInput = '@代码审查 @架构师 这个 API 设计是否合理？需要考虑扩展性';
console.log(`\n测试输入: "${testInput}"`);

const mentions = parser.parseUnique(testInput);
const templates = parser.parseValidTemplates(testInput);
console.log(`解析: ${mentions.length} 个提及, ${templates.length} 个有效模板`);

const session = orchestrator.createSession(testInput);
console.log(`会话 ID: ${session.id}`);
console.log(`参与者: ${session.participants.map(p => p.template.name).join(', ')}`);

orchestrator.run(session.id)
  .then(result => {
    console.log('\n\n=== 讨论结果 ===');
    console.log(`参与者数量: ${result.participantCount}`);
    console.log(`总轮次: ${result.totalRounds}`);
    console.log(`总消息数: ${result.totalMessages}`);
    console.log(`执行时间: ${result.duration}ms`);
    console.log(`\n结论:\n${result.conclusion}`);

    if (result.recommendations.length > 0) {
      console.log('\n建议:');
      result.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    }

    console.log('\n✅ 测试完成');
  })
  .catch(err => {
    console.error('❌ 测试失败:', err);
    process.exit(1);
  });
