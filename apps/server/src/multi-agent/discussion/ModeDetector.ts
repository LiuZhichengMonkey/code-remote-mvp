/**
 * 模式检测器
 * ModeDetector
 *
 * 根据话题内容和参与者自动判断讨论模式
 */

import { AgentTemplate } from './types';

/**
 * 讨论模式
 * 注意：与 types.ts 中的 DiscussionMode 保持一致
 */
export type DiscussionMode = 'debate' | 'collaborate' | 'auto';

/**
 * 话题分析结果
 */
export interface TopicAnalysis {
  /** 是否存在争议性 */
  hasControversy: boolean;
  /** 是否需要事实核查 */
  needsFactCheck: boolean;
  /** 是否有多种解决方案 */
  hasMultipleSolutions: boolean;
  /** 话题类型 */
  topicType: 'decision' | 'analysis' | 'creative' | 'factual';
  /** 检测到的关键词 */
  detectedKeywords: string[];
}

/**
 * 模式检测结果
 */
export interface ModeDetectionResult {
  /** 推荐模式 */
  mode: DiscussionMode;
  /** 判断理由 */
  reason: string;
  /** 话题分析 */
  analysis: TopicAnalysis;
  /** 置信度 (0-1) */
  confidence: number;
}

/**
 * 争议性关键词
 * 这些关键词通常意味着需要对抗性讨论
 */
const CONTROVERSY_KEYWORDS = [
  '是否应该', '对错', '优劣', '利弊', '选择', '方案A还是B',
  '更好', '最佳', '应该', '反对', '支持', '辩论', '争议',
  '是否', '好不好', '值得吗', '哪个更好', '对比', '取舍',
  '权衡', '取舍', '决策', '抉择', '二选一', '多选一'
];

/**
 * 强制模式关键词
 * 用户可以通过这些关键词明确指定讨论模式
 */
const FORCE_DEBATE_KEYWORDS = [
  '[对抗]', '[对抗模式]', '[辩论]', '[辩论模式]',
  '【对抗】', '【对抗模式】', '【辩论】', '【辩论模式】',
  '#对抗#', '#辩论#'
];

const FORCE_COLLABORATE_KEYWORDS = [
  '[协作]', '[协作模式]', '[合作]', '[合作模式]',
  '【协作】', '【协作模式】', '【合作】', '【合作模式】',
  '#协作#', '#合作#'
];

/**
 * 事实核查关键词
 * 这些关键词通常意味着需要事实查证
 */
const FACT_CHECK_KEYWORDS = [
  '数据', '统计', '研究', '报告', '证据', '事实', '准确性',
  '真实性', '来源', '引用', '文献', '论文', '实验', '调查',
  '证明', '证伪', '验证', '核实'
];

/**
 * 创意/分析关键词
 * 这些关键词通常意味着需要协作讨论
 */
const ANALYSIS_KEYWORDS = [
  '分析', '设计', '优化', '改进', '实现', '创意', '头脑风暴',
  '方案', '规划', '架构', '构建', '开发', '创建', '编写',
  '如何', '怎么', '怎样', '思路', '想法', '建议'
];

/**
 * 决策关键词
 * 这些关键词通常意味着需要对抗性讨论来权衡利弊
 */
const DECISION_KEYWORDS = [
  '选', '决策', '决定', '选择', '取舍', '权衡',
  '推荐', '建议', '评估', '评价', '判断'
];

/**
 * 模式检测器类
 */
export class ModeDetector {
  /**
   * 检测讨论模式
   */
  static detect(topic: string, agents: AgentTemplate[]): ModeDetectionResult {
    // 首先检查是否有强制模式关键词
    const forceDebate = FORCE_DEBATE_KEYWORDS.some(kw => topic.includes(kw));
    const forceCollaborate = FORCE_COLLABORATE_KEYWORDS.some(kw => topic.includes(kw));

    if (forceDebate) {
      return {
        mode: 'debate',
        reason: '用户明确指定了对抗模式',
        analysis: {
          hasControversy: true,
          needsFactCheck: false,
          hasMultipleSolutions: false,
          topicType: 'decision',
          detectedKeywords: FORCE_DEBATE_KEYWORDS.filter(kw => topic.includes(kw))
        },
        confidence: 1.0
      };
    }

    if (forceCollaborate) {
      return {
        mode: 'collaborate',
        reason: '用户明确指定了协作模式',
        analysis: {
          hasControversy: false,
          needsFactCheck: false,
          hasMultipleSolutions: true,
          topicType: 'analysis',
          detectedKeywords: FORCE_COLLABORATE_KEYWORDS.filter(kw => topic.includes(kw))
        },
        confidence: 1.0
      };
    }

    // 自动检测模式
    const analysis = this.analyzeTopic(topic);

    // 计算模式得分
    let debateScore = 0;
    let collaborateScore = 0;

    // 争议性话题倾向于对抗模式
    if (analysis.hasControversy) {
      debateScore += 3;
    }

    // 需要事实核查倾向于对抗模式
    if (analysis.needsFactCheck) {
      debateScore += 2;
    }

    // 决策类型倾向于对抗模式
    if (analysis.topicType === 'decision') {
      debateScore += 2;
    }

    // 分析/创意类型倾向于协作模式
    if (analysis.topicType === 'analysis' || analysis.topicType === 'creative') {
      collaborateScore += 3;
    }

    // 多种解决方案倾向于协作模式（需要综合）
    if (analysis.hasMultipleSolutions) {
      collaborateScore += 1;
    }

    // 检查参与的角色
    const hasSkeptic = agents.some(a => a.role === 'Skeptic' || a.id === 'skeptic');
    const hasProposer = agents.some(a => a.role === 'Proposer' || a.id === 'proposer');
    const hasMultipleExperts = agents.length >= 3;

    // 如果有正反方角色，倾向于对抗
    if (hasSkeptic && hasProposer) {
      debateScore += 2;
    }

    // 多个专家倾向于协作
    if (hasMultipleExperts && !hasSkeptic) {
      collaborateScore += 2;
    }

    // 确定模式
    const mode: DiscussionMode = debateScore > collaborateScore ? 'debate' : 'collaborate';

    // 计算置信度
    const totalScore = debateScore + collaborateScore;
    const confidence = totalScore > 0
      ? Math.abs(debateScore - collaborateScore) / totalScore
      : 0.5;

    // 生成理由
    const reason = this.generateReason(mode, analysis, debateScore, collaborateScore);

    return {
      mode,
      reason,
      analysis,
      confidence: Math.min(1, confidence + 0.3) // 提高基础置信度
    };
  }

  /**
   * 分析话题
   */
  private static analyzeTopic(topic: string): TopicAnalysis {
    const lowerTopic = topic.toLowerCase();

    // 检测争议性
    const controversyKeywords = CONTROVERSY_KEYWORDS.filter(kw => lowerTopic.includes(kw));
    const hasControversy = controversyKeywords.length > 0;

    // 检测事实核查需求
    const factCheckKeywords = FACT_CHECK_KEYWORDS.filter(kw => lowerTopic.includes(kw));
    const needsFactCheck = factCheckKeywords.length > 0;

    // 检测多种解决方案
    const hasMultipleSolutions = lowerTopic.includes('方案') ||
      lowerTopic.includes('多个') ||
      lowerTopic.includes('各种') ||
      lowerTopic.includes('比较');

    // 检测创意/分析关键词
    const analysisKeywords = ANALYSIS_KEYWORDS.filter(kw => lowerTopic.includes(kw));

    // 检测决策关键词
    const decisionKeywords = DECISION_KEYWORDS.filter(kw => lowerTopic.includes(kw));

    // 确定话题类型
    let topicType: TopicAnalysis['topicType'] = 'analysis';
    if (hasControversy || decisionKeywords.length > 0) {
      topicType = 'decision';
    } else if (needsFactCheck) {
      topicType = 'factual';
    } else if (analysisKeywords.length > 0) {
      topicType = analysisKeywords.some(kw => ['创意', '头脑风暴', '想法'].includes(kw))
        ? 'creative'
        : 'analysis';
    }

    return {
      hasControversy,
      needsFactCheck,
      hasMultipleSolutions,
      topicType,
      detectedKeywords: [...controversyKeywords, ...factCheckKeywords, ...analysisKeywords, ...decisionKeywords]
    };
  }

  /**
   * 生成模式判断理由
   */
  private static generateReason(
    mode: DiscussionMode,
    analysis: TopicAnalysis,
    debateScore: number,
    collaborateScore: number
  ): string {
    const reasons: string[] = [];

    if (mode === 'debate') {
      reasons.push('话题适合对抗性讨论');

      if (analysis.hasControversy) {
        reasons.push('存在争议性关键词');
      }
      if (analysis.needsFactCheck) {
        reasons.push('需要事实核查');
      }
      if (analysis.topicType === 'decision') {
        reasons.push('属于决策类问题');
      }
    } else {
      reasons.push('话题适合协作讨论');

      if (analysis.topicType === 'creative') {
        reasons.push('属于创意类问题');
      }
      if (analysis.topicType === 'analysis') {
        reasons.push('属于分析类问题');
      }
      if (analysis.hasMultipleSolutions) {
        reasons.push('需要综合多种方案');
      }
    }

    reasons.push(`得分: 对抗=${debateScore}, 协作=${collaborateScore}`);

    return reasons.join('；');
  }

  /**
   * 快速检测模式（简化版）
   */
  static quickDetect(topic: string): DiscussionMode {
    const lowerTopic = topic.toLowerCase();

    // 先检查强制模式关键词
    if (FORCE_DEBATE_KEYWORDS.some(kw => topic.includes(kw))) {
      return 'debate';
    }
    if (FORCE_COLLABORATE_KEYWORDS.some(kw => topic.includes(kw))) {
      return 'collaborate';
    }

    // 快速匹配争议性关键词
    for (const kw of CONTROVERSY_KEYWORDS) {
      if (lowerTopic.includes(kw)) {
        return 'debate';
      }
    }

    // 快速匹配决策关键词
    for (const kw of DECISION_KEYWORDS) {
      if (lowerTopic.includes(kw)) {
        return 'debate';
      }
    }

    // 默认协作模式
    return 'collaborate';
  }

  /**
   * 清理话题中的模式关键词
   * 返回干净的、用于发送给 Agent 的话题
   */
  static stripModeKeywords(topic: string): string {
    let cleaned = topic;

    // 移除强制模式关键词
    for (const kw of [...FORCE_DEBATE_KEYWORDS, ...FORCE_COLLABORATE_KEYWORDS]) {
      cleaned = cleaned.replace(kw, '');
    }

    return cleaned.trim();
  }
}

/**
 * 创建模式检测器实例
 */
export function createModeDetector(): typeof ModeDetector {
  return ModeDetector;
}
