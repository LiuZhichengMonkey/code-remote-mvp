import chalk from 'chalk';

export interface MessageContext {
  clientId: string;
  content: string;
  timestamp: Date;
}

export class MessageHandler {
  private history: MessageContext[] = [];
  private maxHistory: number = 100;

  async handleMessage(clientId: string, content: string): Promise<string> {
    const context: MessageContext = {
      clientId,
      content,
      timestamp: new Date()
    };

    // Store in history
    this.history.push(context);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Log message
    console.log();
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.blue('📱'), `Client ${chalk.cyan(clientId)} says:`);
    console.log(chalk.white(content));
    console.log(chalk.gray('─'.repeat(50)));

    // For MVP, echo back with confirmation
    // In production, this would interface with Claude Code CLI
    const response = this.generateResponse(content);

    return response;
  }

  private generateResponse(content: string): string {
    // Simple MVP responses
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('hello') || lowerContent.includes('hi')) {
      return '👋 Hello! I\'m CodeRemote, your remote Claude Code assistant. How can I help you today?';
    }

    if (lowerContent.includes('help') || lowerContent.includes('?')) {
      return `📖 CodeRemote Commands (MVP):
- Just type your message and I'll respond
- This is a demo - full Claude Code integration coming soon!

Status:
- Server: Running
- Connection: Active`;
    }

    if (lowerContent.includes('status')) {
      return `✅ CodeRemote Status:
- Server: Running
- Message History: ${this.history.length} messages
- Ready to help!`;
    }

    if (lowerContent.includes('time')) {
      return `🕐 Current time: ${new Date().toLocaleString()}`;
    }

    // Default echo response
    return `📨 Received: "${content}"
\nThis is the MVP - full Claude Code integration will allow me to execute code, read files, and more!`;
  }

  getHistory(limit?: number): MessageContext[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }
}
