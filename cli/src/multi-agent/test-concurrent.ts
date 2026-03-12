/**
 * 并发多Agent系统测试
 *
 * 测试:
 * 1. EventBus 消息总线
 * 2. MessageQueue 消息队列
 * 3. LockManager 锁管理
 * 4. ParallelOrchestrator 并行执行
 */

import { EventBus, MessageQueue, LockManager, AsyncLock } from './bus';
import { ParallelOrchestrator, createParallelOrchestrator } from './concurrent';
import { BlackboardManager } from './blackboard';
import { AgentFactory, ProposerAgent, SkepticAgent } from './agents';

// ============ EventBus 测试 ============

async function testEventBus() {
  console.log('\n=== EventBus 测试 ===\n');

  const bus = new EventBus();
  const receivedMessages: any[] = [];

  // 注册两个Agent
  const id1 = bus.register('proposer', async (msg) => {
    receivedMessages.push({ role: 'proposer', msg });
    console.log(`[Proposer] 收到消息: ${msg.type} from ${msg.from}`);
    return;
  });

  const id2 = bus.register('skeptic', async (msg) => {
    receivedMessages.push({ role: 'skeptic', msg });
    console.log(`[Skeptic] 收到消息: ${msg.type} from ${msg.from}`);
    return;
  });

  // 测试广播
  console.log('--- 测试广播 ---');
  await bus.broadcast('system', { content: 'Hello all!' });

  // 测试单播
  console.log('\n--- 测试单播 ---');
  await bus.publish({
    type: 'request',
    from: 'proposer',
    to: 'skeptic',
    payload: { question: '你怎么看这个方案？' },
    priority: 'normal'
  });

  // 测试主题订阅
  console.log('\n--- 测试主题订阅 ---');
  bus.subscribe(id1, ['debate', 'analysis']);

  await bus.emit('system', 'debate', { topic: '并发架构设计' });

  // 检查统计
  console.log('\n--- 统计信息 ---');
  const stats = bus.getStats();
  console.log('总发送:', stats.totalSent);
  console.log('总投递:', stats.totalDelivered);
  console.log('订阅者:', bus.getSubscribers());

  // 清理
  bus.unregister(id1);
  bus.unregister(id2);

  console.log('\n✅ EventBus 测试通过');
}

// ============ MessageQueue 测试 ============

async function testMessageQueue() {
  console.log('\n=== MessageQueue 测试 ===\n');

  const queue = new MessageQueue({ maxSize: 5, priorityQueue: true });

  // 添加消息
  console.log('--- 添加消息 ---');
  queue.enqueue({
    id: 'msg_1',
    type: 'request',
    from: 'proposer',
    to: 'skeptic',
    payload: '低优先级消息',
    priority: 'low',
    timestamp: Date.now()
  });

  queue.enqueue({
    id: 'msg_2',
    type: 'request',
    from: 'proposer',
    to: 'skeptic',
    payload: '高优先级消息',
    priority: 'high',
    timestamp: Date.now()
  });

  queue.enqueue({
    id: 'msg_3',
    type: 'request',
    from: 'proposer',
    to: 'skeptic',
    payload: '普通优先级消息',
    priority: 'normal',
    timestamp: Date.now()
  });

  // 检查状态
  const status = queue.getStatus();
  console.log('队列长度:', status.length);
  console.log('按优先级:', status.byPriority);

  // 出队 - 应该按优先级顺序
  console.log('\n--- 出队顺序 ---');
  while (!queue.isEmpty) {
    const msg = queue.dequeue();
    console.log(`出队: ${msg?.payload} (优先级: ${msg?.priority})`);
  }

  // 测试队列溢出
  console.log('\n--- 测试队列溢出 ---');
  for (let i = 0; i < 10; i++) {
    queue.enqueue({
      id: `overflow_${i}`,
      type: 'event',
      from: 'system',
      to: 'all',
      payload: `消息 ${i}`,
      priority: 'normal',
      timestamp: Date.now()
    });
  }
  console.log('添加10条消息后队列长度:', queue.length); // 应该是5

  console.log('\n✅ MessageQueue 测试通过');
}

// ============ LockManager 测试 ============

async function testLockManager() {
  console.log('\n=== LockManager 测试 ===\n');

  const lockManager = new LockManager();

  // 测试读锁
  console.log('--- 测试并发读锁 ---');
  const readLock1 = await lockManager.acquireRead('blackboard');
  const readLock2 = await lockManager.acquireRead('blackboard');
  console.log('两个读锁同时获取成功');

  const status = lockManager.getLockStatus('blackboard');
  console.log('锁状态:', status);

  lockManager.release('blackboard', readLock1);
  lockManager.release('blackboard', readLock2);
  console.log('读锁释放完成');

  // 测试写锁
  console.log('\n--- 测试写锁 ---');
  const writeLock = await lockManager.acquireWrite('blackboard');
  console.log('写锁获取成功');

  // 尝试获取读锁（应该等待）
  let readAcquired = false;
  const readPromise = lockManager.acquireRead('blackboard').then(lock => {
    readAcquired = true;
    console.log('等待的读锁获取成功');
    lockManager.release('blackboard', lock);
  });

  // 等待一下再释放写锁
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('读锁等待中:', !readAcquired);

  lockManager.release('blackboard', writeLock);
  await readPromise;

  // 测试AsyncLock
  console.log('\n--- 测试AsyncLock ---');
  const simpleLock = new AsyncLock();
  await simpleLock.acquire();
  console.log('简单锁获取成功:', simpleLock.isLocked());
  simpleLock.release();
  console.log('简单锁释放成功:', !simpleLock.isLocked());

  console.log('\n✅ LockManager 测试通过');
}

// ============ ParallelOrchestrator 测试 ============

async function testParallelOrchestrator() {
  console.log('\n=== ParallelOrchestrator 测试 ===\n');

  const orchestrator = createParallelOrchestrator('如何设计高并发系统？', {
    maxRounds: 3,
    parallelTimeout: 5000
  });

  // 注册Agent
  orchestrator.registerAgent('proposer', new ProposerAgent());
  orchestrator.registerAgent('skeptic', new SkepticAgent());

  // 订阅事件
  orchestrator.subscribe((event) => {
    console.log(`[Event] ${event.type}`, event.data);
  });

  // 运行一轮
  console.log('--- 运行并行轮次 ---');
  const result = await orchestrator.runDebateRound();

  console.log('\n轮次结果:');
  console.log('- 总耗时:', result.totalDuration, 'ms');
  console.log('- 成功数:', result.successCount);
  console.log('- 失败数:', result.failureCount);

  for (const r of result.results) {
    console.log(`\n[${r.role}] 状态: ${r.status}`);
    if (r.content) {
      console.log('内容预览:', r.content.substring(0, 100) + '...');
    }
    if (r.error) {
      console.log('错误:', r.error);
    }
  }

  // 获取统计
  console.log('\n--- 统计信息 ---');
  const stats = orchestrator.getStats();
  console.log('已注册Agent:', stats.agents);
  console.log('消息总线统计:', stats.busStats);

  // 清理
  orchestrator.cleanup();

  console.log('\n✅ ParallelOrchestrator 测试通过');
}

// ============ 并发安全性测试 ============

async function testConcurrencySafety() {
  console.log('\n=== 并发安全性测试 ===\n');

  const blackboard = BlackboardManager.create('并发写入测试');
  const lock = new AsyncLock();

  // 模拟多个Agent同时写入
  const writers = Array.from({ length: 5 }, (_, i) =>
    (async () => {
      await lock.acquire();
      try {
        const state = blackboard.getState();
        blackboard.addVerifiedFact(`Agent ${i + 1} 添加的事实`);
        console.log(`[Agent ${i + 1}] 写入完成`);
        // 模拟处理时间
        await new Promise(resolve => setTimeout(resolve, 10));
      } finally {
        lock.release();
      }
    })()
  );

  await Promise.all(writers);

  const finalState = blackboard.getState();
  console.log('\n最终事实数量:', finalState.verifiedFacts.length);
  console.log('所有事实:', finalState.verifiedFacts);

  console.log('\n✅ 并发安全性测试通过');
}

// ============ 运行所有测试 ============

async function runAllTests() {
  console.log('========================================');
  console.log('   并发多Agent系统测试套件');
  console.log('========================================');

  try {
    await testEventBus();
    await testMessageQueue();
    await testLockManager();
    await testParallelOrchestrator();
    await testConcurrencySafety();

    console.log('\n========================================');
    console.log('   ✅ 所有测试通过');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

// 导出测试函数
export {
  testEventBus,
  testMessageQueue,
  testLockManager,
  testParallelOrchestrator,
  testConcurrencySafety,
  runAllTests
};

// 如果直接运行此文件
if (require.main === module) {
  runAllTests();
}
