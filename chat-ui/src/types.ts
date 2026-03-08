export interface ChatOption {
  id?: string;
  label: string;
  description?: string;
  category?: string;
}

// 工具使用记录
export interface ToolUse {
  toolName: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  result?: string;
  isError?: boolean;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error';
  attachments?: Attachment[];
  options?: ChatOption[];
  thinking?: string;
  tools?: ToolUse[];  // 工具使用记录
}

export interface Attachment {
  id: string;
  url: string;
  type: string;
  name: string;
  data?: string; // base64
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}
