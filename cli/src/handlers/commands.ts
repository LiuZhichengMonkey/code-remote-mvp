import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';

// 工作目录 - 允许访问的根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

// 命令类型
export type CommandType =
  | 'read'    // /read <file>
  | 'edit'    // /edit <file> <old> <new>
  | 'glob'    // /glob <pattern>
  | 'grep'    // /grep <pattern> [file]
  | 'ls'      // /ls [dir]
  | 'write'   // /write <file> <content>
  | 'mkdir'   // /mkdir <dir>
  | 'rm'      // /rm <file>
  | 'help';   // /help

export interface CommandResult {
  success: boolean;
  type: CommandType;
  data?: string | string[] | object;
  error?: string;
}

export class CommandHandler {
  private allowedRoot: string;

  constructor(workspaceRoot?: string) {
    this.allowedRoot = path.resolve(workspaceRoot || WORKSPACE_ROOT);
  }

  /**
   * 解析命令字符串
   */
  parseCommand(input: string): { type: CommandType; args: string[] } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const type = parts[0].toLowerCase() as CommandType;
    const args = parts.slice(1);

    const validCommands: CommandType[] = ['read', 'edit', 'glob', 'grep', 'ls', 'write', 'mkdir', 'rm', 'help'];

    if (!validCommands.includes(type)) {
      return null;
    }

    return { type, args };
  }

  /**
   * 处理 WebSocket 命令消息
   */
  async handleCommand(
    ws: WebSocket,
    content: string
  ): Promise<boolean> {
    const parsed = this.parseCommand(content);
    if (!parsed) return false;

    const result = await this.execute(parsed.type, parsed.args);

    ws.send(JSON.stringify({
      type: 'command_result',
      command: parsed.type,
      success: result.success,
      data: result.data,
      error: result.error,
      timestamp: Date.now()
    }));

    return true;
  }

  /**
   * 验证路径是否在允许的工作目录内
   */
  private validatePath(targetPath: string): { valid: boolean; resolved?: string; error?: string } {
    try {
      const resolved = path.resolve(this.allowedRoot, targetPath);
      const normalized = path.normalize(resolved);

      // 检查是否在工作目录内
      if (!normalized.startsWith(this.allowedRoot)) {
        return { valid: false, error: 'Access denied: path outside workspace' };
      }

      return { valid: true, resolved: normalized };
    } catch (e) {
      return { valid: false, error: 'Invalid path' };
    }
  }

  /**
   * 执行命令
   */
  async execute(type: CommandType, args: string[]): Promise<CommandResult> {
    switch (type) {
      case 'read':
        return this.cmdRead(args);
      case 'edit':
        return this.cmdEdit(args);
      case 'glob':
        return this.cmdGlob(args);
      case 'grep':
        return this.cmdGrep(args);
      case 'ls':
        return this.cmdLs(args);
      case 'write':
        return this.cmdWrite(args);
      case 'mkdir':
        return this.cmdMkdir(args);
      case 'rm':
        return this.cmdRm(args);
      case 'help':
        return this.cmdHelp();
      default:
        return { success: false, type, error: 'Unknown command' };
    }
  }

  /**
   * /read <file> - 读取文件内容
   */
  private async cmdRead(args: string[]): Promise<CommandResult> {
    if (args.length < 1) {
      return { success: false, type: 'read', error: 'Usage: /read <file>' };
    }

    const filePath = args[0];
    const validation = this.validatePath(filePath);

    if (!validation.valid) {
      return { success: false, type: 'read', error: validation.error };
    }

    try {
      const content = fs.readFileSync(validation.resolved!, 'utf-8');
      const stats = fs.statSync(validation.resolved!);

      return {
        success: true,
        type: 'read',
        data: {
          path: filePath,
          content,
          size: stats.size,
          modified: stats.mtime
        }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'read', error: `Failed to read file: ${error}` };
    }
  }

  /**
   * /edit <file> <old> <new> - 编辑文件
   */
  private async cmdEdit(args: string[]): Promise<CommandResult> {
    if (args.length < 3) {
      return { success: false, type: 'edit', error: 'Usage: /edit <file> <old_text> <new_text>' };
    }

    const filePath = args[0];
    const oldText = args.slice(1, -1).join(' '); // 支持空格
    const newText = args[args.length - 1];

    const validation = this.validatePath(filePath);
    if (!validation.valid) {
      return { success: false, type: 'edit', error: validation.error };
    }

    try {
      let content = fs.readFileSync(validation.resolved!, 'utf-8');

      if (!content.includes(oldText)) {
        return { success: false, type: 'edit', error: 'Old text not found in file' };
      }

      content = content.replace(oldText, newText);
      fs.writeFileSync(validation.resolved!, content, 'utf-8');

      return {
        success: true,
        type: 'edit',
        data: { path: filePath, message: 'File edited successfully' }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'edit', error: `Failed to edit file: ${error}` };
    }
  }

  /**
   * /glob <pattern> - 搜索文件
   */
  private async cmdGlob(args: string[]): Promise<CommandResult> {
    if (args.length < 1) {
      return { success: false, type: 'glob', error: 'Usage: /glob <pattern>' };
    }

    const pattern = args[0];

    try {
      const { glob } = await import('glob');
      const files = await glob(pattern, {
        cwd: this.allowedRoot,
        nodir: true
      });

      return {
        success: true,
        type: 'glob',
        data: files
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'glob', error: `Glob failed: ${error}` };
    }
  }

  /**
   * /grep <pattern> [file] - 搜索内容
   */
  private async cmdGrep(args: string[]): Promise<CommandResult> {
    if (args.length < 1) {
      return { success: false, type: 'grep', error: 'Usage: /grep <pattern> [file]' };
    }

    const pattern = args[0];
    const filePath = args[1];

    try {
      const results: Array<{ file: string; line: number; content: string }> = [];

      if (filePath) {
        // 在指定文件中搜索
        const validation = this.validatePath(filePath);
        if (!validation.valid) {
          return { success: false, type: 'grep', error: validation.error };
        }

        const content = fs.readFileSync(validation.resolved!, 'utf-8');
        const lines = content.split('\n');
        const regex = new RegExp(pattern, 'gi');

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push({ file: filePath, line: index + 1, content: line.trim() });
          }
        });
      } else {
        // 在所有文件中搜索 (简化版)
        const files = fs.readdirSync(this.allowedRoot, { recursive: true, withFileTypes: true });
        const regex = new RegExp(pattern, 'gi');

        for (const file of files) {
          if (file.isFile() && !file.name.includes('node_modules')) {
            try {
              const fullPath = path.join(file.path || '', file.name);
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');

              lines.forEach((line, index) => {
                if (regex.test(line)) {
                  results.push({
                    file: path.relative(this.allowedRoot, fullPath),
                    line: index + 1,
                    content: line.trim().substring(0, 200)
                  });
                }
              });
            } catch {
              // 跳过无法读取的文件
            }
          }
        }
      }

      return {
        success: true,
        type: 'grep',
        data: results.slice(0, 50) // 限制结果数量
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'grep', error: `Grep failed: ${error}` };
    }
  }

  /**
   * /ls [dir] - 列出目录
   */
  private async cmdLs(args: string[]): Promise<CommandResult> {
    const dir = args[0] || '.';
    const validation = this.validatePath(dir);

    if (!validation.valid) {
      return { success: false, type: 'ls', error: validation.error };
    }

    try {
      const entries = fs.readdirSync(validation.resolved!, { withFileTypes: true });
      const items = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : 'file',
        size: entry.isFile() ? fs.statSync(path.join(validation.resolved!, entry.name)).size : 0
      }));

      return {
        success: true,
        type: 'ls',
        data: {
          path: dir,
          items
        }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'ls', error: `Failed to list directory: ${error}` };
    }
  }

  /**
   * /write <file> <content> - 写入文件
   */
  private async cmdWrite(args: string[]): Promise<CommandResult> {
    if (args.length < 2) {
      return { success: false, type: 'write', error: 'Usage: /write <file> <content>' };
    }

    const filePath = args[0];
    const content = args.slice(1).join(' ');

    const validation = this.validatePath(filePath);
    if (!validation.valid) {
      return { success: false, type: 'write', error: validation.error };
    }

    try {
      // 确保目录存在
      const dir = path.dirname(validation.resolved!);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(validation.resolved!, content, 'utf-8');

      return {
        success: true,
        type: 'write',
        data: { path: filePath, message: 'File written successfully' }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'write', error: `Failed to write file: ${error}` };
    }
  }

  /**
   * /mkdir <dir> - 创建目录
   */
  private async cmdMkdir(args: string[]): Promise<CommandResult> {
    if (args.length < 1) {
      return { success: false, type: 'mkdir', error: 'Usage: /mkdir <dir>' };
    }

    const dir = args[0];
    const validation = this.validatePath(dir);

    if (!validation.valid) {
      return { success: false, type: 'mkdir', error: validation.error };
    }

    try {
      fs.mkdirSync(validation.resolved!, { recursive: true });
      return {
        success: true,
        type: 'mkdir',
        data: { path: dir, message: 'Directory created' }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'mkdir', error: `Failed to create directory: ${error}` };
    }
  }

  /**
   * /rm <file> - 删除文件
   */
  private async cmdRm(args: string[]): Promise<CommandResult> {
    if (args.length < 1) {
      return { success: false, type: 'rm', error: 'Usage: /rm <file>' };
    }

    const filePath = args[0];
    const validation = this.validatePath(filePath);

    if (!validation.valid) {
      return { success: false, type: 'rm', error: validation.error };
    }

    try {
      const stats = fs.statSync(validation.resolved!);

      if (stats.isDirectory()) {
        fs.rmSync(validation.resolved!, { recursive: true });
      } else {
        fs.unlinkSync(validation.resolved!);
      }

      return {
        success: true,
        type: 'rm',
        data: { path: filePath, message: 'Deleted successfully' }
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, type: 'rm', error: `Failed to delete: ${error}` };
    }
  }

  /**
   * /help - 显示帮助
   */
  private cmdHelp(): CommandResult {
    const helpText = `
## 斜杠命令帮助

| 命令 | 用法 | 描述 |
|------|------|------|
| /read | /read <file> | 读取文件内容 |
| /write | /write <file> <content> | 写入文件 |
| /edit | /edit <file> <old> <new> | 编辑文件 |
| /ls | /ls [dir] | 列出目录 |
| /glob | /glob <pattern> | 搜索文件 |
| /grep | /grep <pattern> [file] | 搜索内容 |
| /mkdir | /mkdir <dir> | 创建目录 |
| /rm | /rm <file> | 删除文件 |
| /help | /help | 显示帮助 |

**示例**:
- \`/read src/index.ts\` - 读取文件
- \`/ls src\` - 列出 src 目录
- \`/glob **/*.ts\` - 搜索所有 TypeScript 文件
- \`/grep TODO src/\` - 搜索 TODO
`;

    return {
      success: true,
      type: 'help',
      data: helpText
    };
  }
}
