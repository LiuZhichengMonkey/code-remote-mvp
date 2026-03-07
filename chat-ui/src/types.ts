export interface ChatOption {
  id?: string;
  label: string;
  description?: string;
  category?: string;
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
