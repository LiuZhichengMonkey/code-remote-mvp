/**
 * React Hook 示例
 *
 * 展示如何在 React 应用中使用 CodeRemote
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ============================================
// 类型定义
// ============================================

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  thinking?: string;
  tools?: Array<{
    toolName: string;
    toolInput?: any;
  }>;
}

interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface Project {
  id: string;
  displayName: string;
  sessionCount: number;
  lastActivity: number;
}

interface UseCodeRemoteOptions {
  url: string;
  token: string;
  autoConnect?: boolean;
  onMessage?: (message: Message) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface UseCodeRemoteReturn {
  // 状态
  isConnected: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  messages: Message[];
  sessions: Session[];
  projects: Project[];
  currentSessionId: string | null;

  // 方法
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (content: string) => void;
  createSession: () => void;
  loadSessions: () => void;
  loadProjects: () => void;
  resumeSession: (sessionId: string, projectId?: string) => void;
  clearMessages: () => void;
}

// ============================================
// useCodeRemote Hook
// ============================================

export function useCodeRemote(options: UseCodeRemoteOptions): UseCodeRemoteReturn {
  const {
    url,
    token,
    autoConnect = false,
    onMessage,
    onError,
    onConnect,
    onDisconnect
  } = options;

  // 状态
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // WebSocket 引用
  const wsRef = useRef<WebSocket | null>(null);

  // 当前流式消息引用
  const currentMessageRef = useRef<Message | null>(null);

  // 生成唯一 ID
  const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // 处理 WebSocket 消息
  const handleMessage = useCallback((event: MessageEvent) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'auth_success':
        setIsAuthenticated(true);
        setIsLoading(false);
        setError(null);
        onConnect?.();
        break;

      case 'auth_failed':
        setIsLoading(false);
        setError('认证失败');
        onError?.('认证失败');
        break;

      case 'message':
        handleChatMessage(msg);
        break;

      case 'error':
        setError(msg.content);
        onError?.(msg.content);
        // 添加错误消息
        setMessages(prev => [...prev, {
          id: generateId(),
          role: 'error',
          content: msg.content,
          timestamp: Date.now()
        }]);
        break;

      case 'session_created':
        setCurrentSessionId(msg.sessionId);
        break;

      case 'session_list':
        setSessions(msg.sessions || []);
        break;

      case 'project_list':
        setProjects(msg.projects || []);
        break;

      case 'session_loaded':
        if (msg.messages) {
          setMessages(msg.messages.map((m: any) => ({
            id: m.id || generateId(),
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || Date.now()
          })));
        }
        setCurrentSessionId(msg.sessionId);
        break;
    }
  }, [onConnect, onError]);

  // 处理聊天消息（支持流式）
  const handleChatMessage = useCallback((msg: any) => {
    if (msg.isStreaming) {
      // 流式更新
      if (currentMessageRef.current) {
        // 更新现有消息
        currentMessageRef.current.content += msg.content;
        if (msg.thinking) {
          currentMessageRef.current.thinking = msg.thinking;
        }
        if (msg.tools) {
          currentMessageRef.current.tools = msg.tools;
        }
        // 触发重新渲染
        setMessages(prev => [...prev]);
      } else {
        // 创建新消息
        const newMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: msg.content,
          timestamp: Date.now(),
          isStreaming: true,
          thinking: msg.thinking,
          tools: msg.tools
        };
        currentMessageRef.current = newMessage;
        setMessages(prev => [...prev, newMessage]);
      }
    } else {
      // 消息完成
      if (currentMessageRef.current) {
        currentMessageRef.current.isStreaming = false;
        currentMessageRef.current = null;
      }
    }

    // 回调
    if (onMessage && !msg.isStreaming) {
      onMessage({
        id: generateId(),
        role: 'assistant',
        content: msg.content,
        timestamp: Date.now()
      });
    }
  }, [onMessage]);

  // 连接
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setIsLoading(true);
    setError(null);

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          // 发送认证
          ws.send(JSON.stringify({ type: 'auth', token }));
        };

        ws.onmessage = handleMessage;

        ws.onerror = (error) => {
          setError('连接错误');
          setIsLoading(false);
          reject(error);
        };

        ws.onclose = () => {
          setIsConnected(false);
          setIsAuthenticated(false);
          onDisconnect?.();
        };

        // 等待认证成功
        const checkAuth = setInterval(() => {
          if (isAuthenticated) {
            clearInterval(checkAuth);
            resolve();
          }
        }, 100);

        // 超时
        setTimeout(() => {
          clearInterval(checkAuth);
          if (!isAuthenticated) {
            reject(new Error('连接超时'));
          }
        }, 10000);

      } catch (err) {
        setError('连接失败');
        setIsLoading(false);
        reject(err);
      }
    });
  }, [url, token, handleMessage, isAuthenticated, onDisconnect]);

  // 断开连接
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsAuthenticated(false);
  }, []);

  // 发送消息
  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || !isAuthenticated) {
      setError('未连接');
      return;
    }

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMessage]);

    // 发送到服务器
    wsRef.current.send(JSON.stringify({ type: 'message', content }));

    // 重置流式消息状态
    currentMessageRef.current = null;
  }, [isAuthenticated]);

  // 创建新会话
  const createSession = useCallback(() => {
    if (!wsRef.current || !isAuthenticated) return;

    wsRef.current.send(JSON.stringify({ type: 'session', action: 'new' }));
    setMessages([]);
    setCurrentSessionId(null);
  }, [isAuthenticated]);

  // 加载会话列表
  const loadSessions = useCallback(() => {
    if (!wsRef.current || !isAuthenticated) return;

    wsRef.current.send(JSON.stringify({ type: 'session', action: 'list' }));
  }, [isAuthenticated]);

  // 加载项目列表
  const loadProjects = useCallback(() => {
    if (!wsRef.current || !isAuthenticated) return;

    wsRef.current.send(JSON.stringify({ type: 'session', action: 'list_projects' }));
  }, [isAuthenticated]);

  // 恢复会话
  const resumeSession = useCallback((sessionId: string, projectId?: string) => {
    if (!wsRef.current || !isAuthenticated) return;

    const msg: any = { type: 'session', action: 'resume', sessionId };
    if (projectId) {
      msg.projectId = projectId;
    }
    wsRef.current.send(JSON.stringify(msg));
  }, [isAuthenticated]);

  // 清空消息
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 自动连接
  useEffect(() => {
    if (autoConnect && url && token) {
      connect();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [autoConnect, url, token]);

  return {
    // 状态
    isConnected,
    isAuthenticated,
    isLoading,
    error,
    messages,
    sessions,
    projects,
    currentSessionId,

    // 方法
    connect,
    disconnect,
    sendMessage,
    createSession,
    loadSessions,
    loadProjects,
    resumeSession,
    clearMessages
  };
}

// ============================================
// 使用示例组件
// ============================================

export function CodeRemoteChat() {
  const [input, setInput] = useState('');

  const {
    isConnected,
    isAuthenticated,
    isLoading,
    error,
    messages,
    sessions,
    currentSessionId,
    connect,
    disconnect,
    sendMessage,
    createSession,
    loadSessions
  } = useCodeRemote({
    url: 'ws://localhost:8080',
    token: 'your-token-here',
    onError: (err) => console.error('Error:', err),
    onConnect: () => {
      console.log('Connected!');
      loadSessions();
    }
  });

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isConnected) {
    return (
      <div className="connect-form">
        <button onClick={connect} disabled={isLoading}>
          {isLoading ? '连接中...' : '连接'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="chat-container">
      {/* 头部 */}
      <div className="header">
        <span className="status">
          {isAuthenticated ? '✅ 已连接' : '⏳ 认证中...'}
        </span>
        <button onClick={createSession}>新建会话</button>
        <button onClick={disconnect}>断开</button>
      </div>

      {/* 会话列表 */}
      <div className="sessions">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
            onClick={() => {/* resumeSession(session.id) */}}
          >
            {session.title || '新会话'}
          </div>
        ))}
      </div>

      {/* 消息列表 */}
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className="content">{msg.content}</div>
            {msg.thinking && (
              <div className="thinking">{msg.thinking}</div>
            )}
            {msg.isStreaming && <span className="cursor">▊</span>}
          </div>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={3}
        />
        <button onClick={handleSend} disabled={!input.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}

export default useCodeRemote;
