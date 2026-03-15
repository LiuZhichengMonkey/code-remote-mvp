/**
 * 测试讨论系统
 *
 * 验证 @语法解析和多 Agent 讨论
 */

import { DiscussionOrchestrator, AgentParser, BUILTIN_TEMPLATES, createDiscussionOrchestrator } from './discussion';

// 测试 AgentParser
console.log('=== 测试 AgentParser ===\n');

const parser = new AgentParser();
parser.registerTemplates(BUILTIN_TEMPLATES);

// 测试解析
const testInput = '@代码审查 @架构师 这个 API 设计是否合理？需要考虑扩展性和安全性';
console.log('输入:', testInput);

const mentions = parser.parseUnique(testInput);
console.log('\n解析结果:');
mentions.forEach(m => {
  console.log(`  - @${m.name}: ${m.valid ? '有效' : '无效'}`);
});

const templates = parser.parseValidTemplates(testInput);
console.log('\n匹配的模板:');
templates.forEach(t => {
  console.log(`  - ${t.name} (${t.role})`);
});

const task = parser.removeMentions(testInput);
console.log('\n提取的任务:', task);

// 测试 DiscussionOrchestrator
console.log('\n\n=== 测试 DiscussionOrchestrator ===\n');

const orchestrator = createDiscussionOrchestrator({
  maxRounds: 2
});

// 订阅事件
orchestrator.subscribe(event => {
  switch (event.type) {
    case 'session_start':
      console.log(`[开始] ${event.data}`);
      break;
    case 'message':
      const msg = event.data as any;
      if (msg.type === 'agent') {
        console.log(`\n[${msg.sender}] (${msg.role}):`);
        console.log(msg.content);
      }
      break;
    case 'round_complete':
      console.log(`\n--- ${event.data} ---`);
      break;
    case 'session_end':
      console.log(`\n[结论]\n${event.data}`);
      break;
  }
});

// 创建会话
const session = orchestrator.createSession(testInput);
console.log('会话 ID:', session.id);
console.log('参与者:', session.participants.map(p => p.template.name).join(', '));

// 运行讨论
console.log('\n开始讨论...\n');

orchestrator.run(session.id)
  .then(result => {
    console.log('\n\n=== 讨论结果 ===\n');
    console.log('参与者数量:', result.participantCount);
    console.log('总轮次:', result.totalRounds);
    console.log('总消息数:', result.totalMessages);
    console.log('执行时间:', result.duration, 'ms');
    console.log('\n共识点:', result.agreements.join(', '));
    console.log('\n建议:');
    result.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  })
  .catch(err => {
    console.error('讨论失败:', err);
  });
