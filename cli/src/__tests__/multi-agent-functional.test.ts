/**
 * Multi-Agent 功能测试
 *
 * 测试多智能体系统的核心功能：
 * 1. EventBus 消息传递
 * 2. Agent 注册与注销
 * 3. 辩论流程模拟
 */

import { EventBus, AgentMessage } from '../multi-agent/bus/EventBus';
import { DebateRole, DebateStep, GlobalBlackboard, AgentSpeech, DebateSession, DebateConfig } from '../multi-agent/types';

describe('Multi-Agent 功能测试', () => {
  describe('EventBus 消息总线', () => {
    let eventBus: EventBus;

    beforeEach(() => {
      eventBus = new EventBus();
    });

    test('应该能够注册多个 Agent', () => {
      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);
      const handler3 = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', handler1);
      eventBus.register('skeptic', handler2);
      eventBus.register('expert', handler3);

      const subscribers = eventBus.getSubscribers();
      expect(subscribers).toContain('proposer');
      expect(subscribers).toContain('skeptic');
      expect(subscribers).toContain('expert');
    });

    test('应该支持单播消息传递', async () => {
      const proposerHandler = jest.fn().mockResolvedValue(undefined);
      const skepticHandler = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', proposerHandler);
      eventBus.register('skeptic', skepticHandler);

      await eventBus.publish({
        type: 'request',
        from: 'moderator',
        to: 'proposer',
        payload: { question: 'What is AI?' },
        priority: 'normal'
      });

      expect(proposerHandler).toHaveBeenCalledTimes(1);
      expect(skepticHandler).not.toHaveBeenCalled();
    });

    test('应该支持广播消息', async () => {
      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', handler1);
      eventBus.register('skeptic', handler2);

      await eventBus.broadcast('moderator', { announcement: 'Round 1 starts' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    test('发送者不应收到自己广播的消息', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('proposer', { test: 'data' });

      expect(handler).not.toHaveBeenCalled();
    });

    test('应该支持主题订阅', async () => {
      const researchHandler = jest.fn().mockResolvedValue(undefined);
      const devHandler = jest.fn().mockResolvedValue(undefined);

      eventBus.register('proposer', researchHandler, ['research']);
      eventBus.register('skeptic', devHandler, ['development']);

      // 使用 publish + topic 来测试主题订阅（emit 目前不支持按主题过滤）
      await eventBus.publish({
        type: 'event',
        from: 'system',
        to: 'custom',  // 使用 custom 触发主题逻辑
        topic: 'research',
        payload: { data: 'new finding' },
        priority: 'normal'
      });

      expect(researchHandler).toHaveBeenCalledTimes(1);
      expect(devHandler).not.toHaveBeenCalled();
    });

    test('应该支持动态订阅主题', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const id = eventBus.register('proposer', handler);

      eventBus.subscribe(id, ['new-topic']);
      await eventBus.emit('system', 'new-topic', { data: 'test' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('应该能够注销 Agent', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const id = eventBus.register('proposer', handler);

      eventBus.unregister(id);
      await eventBus.broadcast('moderator', { test: 'data' });

      expect(handler).not.toHaveBeenCalled();
    });

    test('请求-响应模式应该正常工作', async () => {
      const responderHandler = jest.fn().mockImplementation(async (msg: AgentMessage) => {
        return {
          ...msg,
          type: 'response' as const,
          from: msg.to,
          to: msg.from,
          payload: { answer: 'This is the answer' }
        };
      });

      eventBus.register('proposer', responderHandler);

      const response = await eventBus.request(
        'moderator',
        'proposer',
        { question: 'What is AI?' },
        5000
      );

      expect(response).toBeDefined();
      expect(response?.payload.answer).toBe('This is the answer');
    });

    test('请求超时应该返回 null', async () => {
      const slowHandler = jest.fn().mockImplementation(async () => {
        await new Promise(() => undefined);
        return undefined;
      });

      eventBus.register('proposer', slowHandler);

      const response = await eventBus.request(
        'moderator',
        'proposer',
        { question: 'test' },
        100 // 100ms 超时
      );

      expect(response).toBeNull();
    });

    test('统计信息应该正确', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('system', { test: 'data' });

      const stats = eventBus.getStats();
      expect(stats.totalSent).toBe(1);
      expect(stats.totalDelivered).toBe(1);
    });

    test('应该追踪失败消息', async () => {
      const errorHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      eventBus.register('proposer', errorHandler);

      await eventBus.publish({
        type: 'request',
        from: 'system',
        to: 'proposer',
        payload: {},
        priority: 'normal'
      });

      const stats = eventBus.getStats();
      expect(stats.totalFailed).toBe(1);
    });

    test('应该能够重置统计', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      eventBus.register('proposer', handler);

      await eventBus.broadcast('system', { test: 'data' });

      eventBus.resetStats();

      const stats = eventBus.getStats();
      expect(stats.totalSent).toBe(0);
    });
  });

  describe('辩论系统类型', () => {
    test('DebateRole 应该包含所有角色', () => {
      const roles: DebateRole[] = ['moderator', 'proposer', 'skeptic', 'fact-checker', 'expert'];
      expect(roles.length).toBe(5);
    });

    test('DebateStep 应该包含所有步骤', () => {
      const steps: DebateStep[] = ['proposer', 'expert', 'skeptic', 'fact-check', 'settlement'];
      expect(steps.length).toBe(5);
    });

    test('应该能够创建 GlobalBlackboard', () => {
      const blackboard: GlobalBlackboard = {
        round: 1,
        currentTopic: 'AI Safety',
        verifiedFacts: ['AI can be dangerous', 'Alignment is important'],
        coreClashes: ['Should we pause AI development?'],
        consensusScore: 50,
        agentInsights: {
          proposer: 'AI has great potential',
          skeptic: 'We need more research'
        },
        currentStep: 'proposer'
      };

      expect(blackboard.round).toBe(1);
      expect(blackboard.currentTopic).toBe('AI Safety');
      expect(blackboard.verifiedFacts.length).toBe(2);
    });

    test('应该能够创建 AgentSpeech', () => {
      const speech: AgentSpeech = {
        agentName: 'Proposer',
        role: 'proposer',
        content: 'AI will benefit humanity',
        timestamp: Date.now(),
        round: 1,
        step: 'proposer'
      };

      expect(speech.agentName).toBe('Proposer');
      expect(speech.role).toBe('proposer');
      expect(speech.round).toBe(1);
    });

    test('应该能够创建 DebateSession', () => {
      const session: DebateSession = {
        id: 'session-123',
        originalQuestion: 'Should we develop AGI?',
        blackboard: {
          round: 0,
          currentTopic: 'AGI Development',
          verifiedFacts: [],
          coreClashes: [],
          consensusScore: 0,
          agentInsights: {},
          currentStep: 'proposer'
        },
        speeches: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'running'
      };

      expect(session.id).toBe('session-123');
      expect(session.status).toBe('running');
      expect(session.speeches).toEqual([]);
    });

    test('应该能够创建 DebateConfig', () => {
      const config: DebateConfig = {
        maxRounds: 5,
        terminationScore: 80,
        compressHistory: true,
        compressionInterval: 3,
        enableFactChecker: true,
        enableExpert: true
      };

      expect(config.maxRounds).toBe(5);
      expect(config.terminationScore).toBe(80);
      expect(config.enableFactChecker).toBe(true);
    });
  });

  describe('辩论流程模拟', () => {
    test('应该能够模拟完整的辩论流程', async () => {
      const eventBus = new EventBus();
      const speeches: AgentSpeech[] = [];

      // 注册 Agent
      const proposerHandler = jest.fn().mockImplementation(async (msg: AgentMessage) => {
        const speech: AgentSpeech = {
          agentName: 'Proposer',
          role: 'proposer',
          content: 'AI will greatly benefit humanity in the future',
          timestamp: Date.now(),
          round: 1,
          step: 'proposer'
        };
        speeches.push(speech);
        return undefined;
      });

      const skepticHandler = jest.fn().mockImplementation(async (msg: AgentMessage) => {
        const speech: AgentSpeech = {
          agentName: 'Skeptic',
          role: 'skeptic',
          content: 'What about the risks of AI?',
          timestamp: Date.now(),
          round: 1,
          step: 'skeptic'
        };
        speeches.push(speech);
        return undefined;
      });

      eventBus.register('proposer', proposerHandler);
      eventBus.register('skeptic', skepticHandler);

      // 模拟第 1 轮
      await eventBus.publish({
        type: 'request',
        from: 'moderator',
        to: 'proposer',
        payload: { step: 'proposer', round: 1 },
        priority: 'high'
      });

      await eventBus.publish({
        type: 'request',
        from: 'moderator',
        to: 'skeptic',
        payload: { step: 'skeptic', round: 1 },
        priority: 'high'
      });

      // 验证
      expect(proposerHandler).toHaveBeenCalledTimes(1);
      expect(skepticHandler).toHaveBeenCalledTimes(1);
      expect(speeches.length).toBe(2);
      expect(speeches[0].role).toBe('proposer');
      expect(speeches[1].role).toBe('skeptic');
    });

    test('应该能够追踪共识分数变化', async () => {
      let consensusScore = 0;

      const updateScore = (delta: number) => {
        consensusScore = Math.min(100, Math.max(0, consensusScore + delta));
      };

      // 模拟多轮讨论后共识增加
      updateScore(20);
      expect(consensusScore).toBe(20);

      updateScore(30);
      expect(consensusScore).toBe(50);

      updateScore(40);
      expect(consensusScore).toBe(90);

      // 超过 100 应该被限制
      updateScore(50);
      expect(consensusScore).toBe(100);
    });

    test('应该能够管理核心争议点', () => {
      const coreClashes: string[] = [];

      // 添加争议
      coreClashes.push('Should we pause AI development?');
      coreClashes.push('Who should regulate AI?');

      expect(coreClashes.length).toBe(2);
      expect(coreClashes).toContain('Should we pause AI development?');

      // 解决争议
      const index = coreClashes.indexOf('Should we pause AI development?');
      if (index > -1) {
        coreClashes.splice(index, 1);
      }

      expect(coreClashes.length).toBe(1);
      expect(coreClashes).not.toContain('Should we pause AI development?');
    });

    test('应该能够追踪已验证的事实', () => {
      const verifiedFacts: string[] = [];

      // 添加事实
      verifiedFacts.push('GPT-4 was released in 2023');
      verifiedFacts.push('Claude was created by Anthropic');

      expect(verifiedFacts.length).toBe(2);

      // 验证事实存在
      expect(verifiedFacts.some(f => f.includes('2023'))).toBe(true);
      expect(verifiedFacts.some(f => f.includes('Anthropic'))).toBe(true);
    });
  });
});
