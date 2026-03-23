import chalk from 'chalk';

export interface MessageContext {
  clientId: string;
  content: string;
  timestamp: Date;
}

export class MessageHandler {
  private history: MessageContext[] = [];
  private maxHistory = 100;

  async handleMessage(clientId: string, content: string): Promise<string> {
    const context: MessageContext = {
      clientId,
      content,
      timestamp: new Date()
    };

    this.history.push(context);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    console.log();
    console.log(chalk.gray('-'.repeat(50)));
    console.log(chalk.blue('msg'), `Client ${chalk.cyan(clientId)} says:`);
    console.log(chalk.white(content));
    console.log(chalk.gray('-'.repeat(50)));

    return this.generateResponse(content);
  }

  private generateResponse(content: string): string {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('hello') || lowerContent.includes('hi')) {
      return 'Hello! I\'m CodeRemote, your remote Claude/Codex assistant. How can I help you today?';
    }

    if (lowerContent.includes('help') || lowerContent.includes('?')) {
      return `CodeRemote Commands (MVP):
- Just type your message and I'll respond
- This is a demo shell. The full provider runtime handles Claude and Codex sessions.

Status:
- Server: Running
- Connection: Active`;
    }

    if (lowerContent.includes('status')) {
      return `CodeRemote Status:
- Server: Running
- Message History: ${this.history.length} messages
- Ready to help!`;
    }

    if (lowerContent.includes('time')) {
      return `Current time: ${new Date().toLocaleString()}`;
    }

    return `Received: "${content}"

This is the MVP shell. The full provider runtime can execute code, read files, and manage sessions.`;
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
