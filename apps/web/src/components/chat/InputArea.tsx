import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Mic, Paperclip, Send, Square, X } from 'lucide-react';
import { Attachment, SkillOption } from '../../types';
import { cn } from '../../utils';
import { debugLog } from '../../debugLog';
import { useI18n } from '../../i18n';

type SkillTriggerPrefix = '/' | '$';

interface InputAreaProps {
  onSend: (text: string, files: Attachment[]) => void;
  isGenerating: boolean;
  onStop: () => void;
  isConnected: boolean;
  onFocus?: () => void;
  onActivity?: (reason: string) => void;
  availableSkills: SkillOption[];
  skillsLoading: boolean;
  skillsLoadFailed: boolean;
}

export const InputArea = ({
  onSend,
  isGenerating,
  onStop,
  isConnected,
  onFocus,
  onActivity,
  availableSkills,
  skillsLoading,
  skillsLoadFailed
}: InputAreaProps) => {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');
  const [skillTriggerPrefix, setSkillTriggerPrefix] = useState<SkillTriggerPrefix>('/');
  const [showAgents, setShowAgents] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentStartPos, setAgentStartPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fallbackSkills: SkillOption[] = [
    { id: 'git-commit', name: t('input.skill.gitCommit.name'), description: t('input.skill.gitCommit.description'), command: 'git-workflow' },
    { id: 'create-readme', name: t('input.skill.createReadme.name'), description: t('input.skill.createReadme.description'), command: 'create-readme' },
    { id: 'simplify', name: t('input.skill.simplify.name'), description: t('input.skill.simplify.description'), command: 'simplify' },
    { id: 'brainstorm', name: t('input.skill.brainstorm.name'), description: t('input.skill.brainstorm.description'), command: 'brainstorming' },
  ];
  const skills = availableSkills.length > 0 || !skillsLoadFailed
    ? availableSkills
    : fallbackSkills;

  const agents = [
    { id: 'code-reviewer', name: t('input.agent.codeReviewer.name'), alias: 'code-reviewer', icon: 'CR', color: '#4CAF50', description: t('input.agent.codeReviewer.description') },
    { id: 'architect', name: t('input.agent.architect.name'), alias: 'architect', icon: 'AR', color: '#2196F3', description: t('input.agent.architect.description') },
    { id: 'tester', name: t('input.agent.tester.name'), alias: 'tester', icon: 'TS', color: '#FF9800', description: t('input.agent.tester.description') },
    { id: 'security', name: t('input.agent.security.name'), alias: 'security', icon: 'SEC', color: '#F44336', description: t('input.agent.security.description') },
    { id: 'performance', name: t('input.agent.performance.name'), alias: 'performance', icon: 'PF', color: '#9C27B0', description: t('input.agent.performance.description') },
    { id: 'product', name: t('input.agent.product.name'), alias: 'product', icon: 'PM', color: '#00BCD4', description: t('input.agent.product.description') },
    { id: 'devops', name: t('input.agent.devops.name'), alias: 'devops', icon: 'OP', color: '#607D8B', description: t('input.agent.devops.description') },
  ];

  const filteredSkills = skillFilter
    ? skills.filter(s => (
        s.name.toLowerCase().includes(skillFilter.toLowerCase())
        || s.description.toLowerCase().includes(skillFilter.toLowerCase())
        || s.command.toLowerCase().includes(skillFilter.toLowerCase())
      ))
    : skills;

  const filteredAgents = agentFilter
    ? agents.filter(a =>
        a.name.includes(agentFilter) ||
        a.alias.toLowerCase().includes(agentFilter.toLowerCase()) ||
        a.description.includes(agentFilter)
      )
    : agents;

  const getSkillPrefix = (value: string): SkillTriggerPrefix | null => {
    if (!value) {
      return null;
    }

    if (value.startsWith('/')) {
      return '/';
    }

    if (value.startsWith('$')) {
      return '$';
    }

    return null;
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onActivity?.('input_change');
    setInput(value);

    const nextSkillPrefix = getSkillPrefix(value);
    if (nextSkillPrefix) {
      setShowSkills(true);
      setSkillFilter(value.slice(1));
      setSkillTriggerPrefix(nextSkillPrefix);
      setShowAgents(false);
    } else if (showSkills && !nextSkillPrefix) {
      setShowSkills(false);
      setSkillFilter('');
    }

    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('@')) {
        setShowAgents(true);
        setAgentFilter(textAfterAt);
        setAgentStartPos(lastAtIndex);
        setShowSkills(false);
      } else {
        setShowAgents(false);
      }
    } else {
      setShowAgents(false);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  const handleSelectSkill = (skill: SkillOption) => {
    const skillMessage = `${skillTriggerPrefix}${skill.command} `;
    onActivity?.('select_skill');
    debugLog('[handleSelectSkill] skill:', skill.name, 'message:', skillMessage, 'isConnected:', isConnected, 'isGenerating:', isGenerating);
    setInput(skillMessage);
    setShowSkills(false);
    setSkillFilter('');

    if (isConnected && !isGenerating) {
      debugLog('[handleSelectSkill] Calling onSend...');
      onSend(skillMessage, []);
    } else {
      debugLog('[handleSelectSkill] NOT sending - isConnected:', isConnected, 'isGenerating:', isGenerating);
    }
  };

  const handleSelectAgent = (agent: typeof agents[0]) => {
    onActivity?.('select_agent');
    const value = input;
    const beforeAt = value.slice(0, agentStartPos);
    const afterFilter = value.slice(agentStartPos + 1 + agentFilter.length);
    const newValue = `${beforeAt}@${agent.name} ${afterFilter}`;
    setInput(newValue);
    setShowAgents(false);
    setAgentFilter('');

    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newValue.length, newValue.length);
    }, 0);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    onActivity?.('select_file');
    const selectedFiles = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = await Promise.all(
      selectedFiles.map(file => new Promise<Attachment>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({
            id: Math.random().toString(36).substr(2, 9),
            url: URL.createObjectURL(file),
            type: file.type,
            name: file.name,
            size: file.size,
            data: (reader.result as string).split(',')[1]
          });
        };
        reader.readAsDataURL(file);
      }))
    );
    setFiles(prev => [...prev, ...newAttachments]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleSubmit = () => {
    if ((!input.trim() && files.length === 0) || isGenerating || !isConnected) {
      return;
    }
    onSend(input, files);
    setInput('');
    setFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-2xl border-t border-white/5 pb-[env(safe-area-inset-bottom)]">
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex gap-3 px-4 py-3 overflow-x-auto no-scrollbar"
          >
            {files.map(file => (
              <div key={file.id} className="relative flex-shrink-0">
                {file.type.startsWith('image/') ? (
                  <img
                    src={file.url}
                    alt={t('input.filePreviewAlt')}
                    className="w-16 h-16 object-cover rounded-lg border border-white/10"
                  />
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center bg-white/10 rounded-lg border border-white/10">
                    <FileText size={24} className="text-white/50" />
                  </div>
                )}
                <button
                  onClick={() => removeFile(file.id)}
                  className="absolute -top-2 -right-2 bg-black/80 text-white rounded-full p-0.5 border border-white/20"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2 px-3 py-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 text-white/50 hover:text-white active:scale-95 transition-transform disabled:opacity-30"
          disabled={!isConnected}
        >
          <Paperclip size={22} />
        </button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept="*/*"
          onChange={handleFileSelect}
        />

        <div className="flex-1 relative bg-white/5 rounded-2xl border border-white/10 focus-within:border-accent/50 transition-colors">
          {isRecording ? (
            <div className="flex items-center justify-between px-4 h-[44px]">
              <div className="flex gap-1 items-center">
                <div className="w-1 h-4 bg-accent animate-pulse rounded-full" />
                <div className="w-1 h-6 bg-accent animate-pulse rounded-full delay-75" />
                <div className="w-1 h-3 bg-accent animate-pulse rounded-full delay-150" />
                <div className="w-1 h-5 bg-accent animate-pulse rounded-full delay-100" />
                <span className="text-xs text-white/40 ml-2">{t('input.listening')}</span>
              </div>
              <button
                onClick={toggleRecording}
                className="text-accent text-[14px] font-medium"
              >
                {t('common.done')}
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleTextareaChange}
              onFocus={onFocus}
              placeholder={isConnected ? t('input.placeholder.connected') : t('input.placeholder.disconnected')}
              className="w-full bg-transparent text-white px-4 py-2.5 resize-none focus:outline-none text-[16px] max-h-[120px] disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={!isConnected}
              onBlur={() => setTimeout(() => setShowSkills(false), 200)}
            />
          )}

          {showSkills && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-2 border-b border-white/10">
                <span className="text-xs text-white/50">{t('input.skills.title')}</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {filteredSkills.length === 0 ? (
                  skillsLoading && !skillsLoadFailed ? (
                    <div className="p-3 text-xs text-white/40">{t('common.loading')}</div>
                  ) : (
                  <div className="p-3 text-xs text-white/40">{t('input.skills.empty')}</div>
                  )
                ) : (
                  filteredSkills.map(skill => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill)}
                      className="w-full p-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0 text-sm font-medium text-white truncate">{skill.name}</div>
                      <span className="text-xs text-accent font-mono">{`${skillTriggerPrefix}${skill.command}`}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {showAgents && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-white/10 rounded-xl shadow-lg overflow-hidden z-50">
              <div className="p-2 border-b border-white/10">
                <span className="text-xs text-white/50">{t('input.agents.title')}</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {filteredAgents.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">{t('input.agents.empty')}</div>
                ) : (
                  filteredAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent)}
                      className="w-full p-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
                    >
                      <span className="text-xl" style={{ color: agent.color }}>{agent.icon}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">{agent.name}</div>
                        <div className="text-xs text-white/40">{agent.description}</div>
                      </div>
                      <span className="text-xs text-white/30 font-mono">@{agent.alias}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {isGenerating ? (
          <button
            onClick={onStop}
            className="p-2.5 bg-white/10 text-white rounded-full active:scale-90 transition-transform"
          >
            <Square size={20} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={toggleRecording}
            className={cn(
              'p-2.5 rounded-full transition-all active:scale-90',
              isRecording ? 'bg-accent text-white' : 'text-white/50 hover:text-white'
            )}
          >
            <Mic size={22} />
          </button>
        )}

        {input.trim() || files.length > 0 ? (
          <button
            onClick={handleSubmit}
            disabled={isGenerating || !isConnected}
            className="p-2.5 bg-accent text-white rounded-full active:scale-90 transition-transform disabled:opacity-50"
          >
            <Send size={20} />
          </button>
        ) : null}
      </div>
    </div>
  );
};
