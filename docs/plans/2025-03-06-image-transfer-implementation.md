# 图片传输功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 实现双向图片传输功能，支持手机和电脑之间通过 WebSocket 传输图片

**架构:** 使用 WebSocket 二进制帧传输，元数据（JSON）和图片数据分离发送

**技术栈:** Node.js (ws), TypeScript, HTML5 File API, Buffer/ArrayBuffer

---

## 前置准备

### 确保目录存在
```bash
mkdir -p E:/CodeRemote/Images
```

---

## Task 1: 添加图片类型定义

**文件:**
- 新建: `cli/src/types/image.ts`

**步骤 1: 创建类型定义文件**

```typescript
export interface ImageMeta {
  fileName: string;
  mimeType: string;
  size: number;
  timestamp?: number;
}

export interface ImageConfig {
  savePath: string;
  maxSize: number;
  allowedTypes: string[];
  createDirectory: boolean;
}

export interface ImageTransferState {
  inProgress: boolean;
  meta: ImageMeta | null;
  startTime: number;
}

export interface ImageSavedResponse {
  type: 'image_saved';
  path: string;
  timestamp: number;
}

export interface ImageErrorResponse {
  type: 'image_error';
  error: string;
  code: 'TOO_LARGE' | 'INVALID_TYPE' | 'TIMEOUT' | 'DISK_FULL' | 'PROTOCOL_ERROR';
  timestamp: number;
}
```

**步骤 2: 运行编译检查**
```bash
cd E:/code-remote-mvp/cli
npx tsc --noEmit
```
期望: 无错误

**步骤 3: 提交**
```bash
git add cli/src/types/image.ts
git commit -m "feat: 添加图片传输类型定义"
```

---

## Task 2: 实现 ImageHandler 类

**文件:**
- 新建: `cli/src/imageHandler.ts`
- 修改: `cli/src/server.ts` - 导入 ImageHandler

**步骤 1: 编写测试**

```typescript
// cli/src/imageHandler.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ImageHandler } from './imageHandler';

describe('ImageHandler', () => {
  let imageHandler: ImageHandler;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderemote-test-'));
    imageHandler = new ImageHandler({
      savePath: testDir,
      maxSize: 1024 * 1024, // 1MB for testing
      allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      createDirectory: true
    });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('应该正确保存 PNG 图片', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const testData = Buffer.concat([pngHeader, Buffer.alloc(100)]);

    const meta = {
      fileName: 'test.png',
      mimeType: 'image/png',
      size: testData.length
    };

    const savedPath = await imageHandler.handleImage('client1', testData, meta);

    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toMatch(/\.png$/);
  });

  test('应该拒绝过大的图片', async () => {
    const largeBuffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
    const meta = {
      fileName: 'large.png',
      mimeType: 'image/png',
      size: largeBuffer.length
    };

    await expect(
      imageHandler.handleImage('client1', largeBuffer, meta)
    ).rejects.toThrow('图片过大');
  });

  test('应该拒绝不支持的文件类型', async () => {
    const buffer = Buffer.from('test data');
    const meta = {
      fileName: 'test.bmp',
      mimeType: 'image/bmp',
      size: buffer.length
    };

    await expect(
      imageHandler.handleImage('client1', buffer, meta)
    ).rejects.toThrow('不支持的文件类型');
  });

  test('应该生成唯一的文件名', () => {
    const name1 = imageHandler.generateFileName('test.png');
    const name2 = imageHandler.generateFileName('test.png');

    expect(name1).not.toBe(name2);
    expect(name1).toMatch(/^image_\d{8}_\d{6}\.png$/);
  });

  test('应该自动创建保存目录', async () => {
    const newDir = path.join(testDir, 'subfolder', 'nested');
    const handler = new ImageHandler({
      savePath: newDir,
      maxSize: 1024 * 1024,
      allowedTypes: ['image/png'],
      createDirectory: true
    });

    const testData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const meta = { fileName: 'test.png', mimeType: 'image/png', size: testData.length };

    const savedPath = await handler.handleImage('client1', testData, meta);

    expect(fs.existsSync(savedPath)).toBe(true);
  });
});
```

**步骤 2: 运行测试验证失败**
```bash
cd E:/code-remote-mvp/cli
npx jest cli/src/imageHandler.test.ts --testPathPattern=imageHandler 2>&1 || echo "Expected: test file not found"
```
期望: 测试文件不存在

**步骤 3: 实现 ImageHandler 类**

```typescript
// cli/src/imageHandler.ts
import fs from 'fs';
import path from 'path';
import { ImageMeta, ImageConfig } from './types/image';

export class ImageHandler {
  private savePath: string;
  private maxSize: number;
  private allowedTypes: string[];

  constructor(config: ImageConfig) {
    this.savePath = config.savePath;
    this.maxSize = config.maxSize;
    this.allowedTypes = config.allowedTypes;

    if (config.createDirectory && !fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }
  }

  async handleImage(clientId: string, buffer: Buffer, meta: ImageMeta): Promise<string> {
    // 验证文件大小
    if (meta.size > this.maxSize) {
      throw new Error(`图片过大 (${meta.size} 字节)，最大支持 ${this.maxSize} 字节`);
    }

    // 验证文件类型
    if (!this.allowedTypes.includes(meta.mimeType)) {
      throw new Error(`不支持的文件类型: ${meta.mimeType}`);
    }

    // 验证魔数（文件头）
    this.validateImageHeader(buffer, meta.mimeType);

    // 生成文件名
    const fileName = this.generateFileName(meta.fileName);
    const filePath = path.join(this.savePath, fileName);

    // 写入文件
    try {
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (error: any) {
      if (error.code === 'ENOSPC') {
        throw new Error('磁盘空间不足，请清理 E 盘空间');
      }
      throw error;
    }
  }

  async loadImage(filePath: string): Promise<{ buffer: Buffer; meta: ImageMeta }> {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };

    return {
      buffer,
      meta: {
        fileName: path.basename(filePath),
        mimeType: mimeMap[ext] || 'image/png',
        size: buffer.length
      }
    };
  }

  generateFileName(originalName: string): string {
    const ext = path.extname(originalName);
    const timestamp = this.getTimestamp();
    return `image_${timestamp}${ext}`;
  }

  private validateImageHeader(buffer: Buffer, mimeType: string): void {
    const signatures: Record<string, number[]> = {
      'image/png': [0x89, 0x50, 0x4E, 0x47],
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/gif': [0x47, 0x49, 0x46, 0x38],
      'image/webp': [0x52, 0x49, 0x46, 0x46]
    };

    const expected = signatures[mimeType];
    if (!expected) return;

    for (let i = 0; i < expected.length; i++) {
      if (buffer[i] !== expected[i]) {
        throw new Error('文件内容与声明的类型不匹配');
      }
    }
  }

  private getTimestamp(): string {
    const now = new Date();
    const date = now.getFullYear().toString() +
                 (now.getMonth() + 1).toString().padStart(2, '0') +
                 now.getDate().toString().padStart(2, '0');
    const time = now.getHours().toString().padStart(2, '0') +
                 now.getMinutes().toString().padStart(2, '0') +
                 now.getSeconds().toString().padStart(2, '0');
    return `${date}_${time}`;
  }
}
```

**步骤 4: 运行测试**
```bash
cd E:/code-remote-mvp/cli
npx jest cli/src/imageHandler.test.ts
```
期望: 全部通过

**步骤 5: 提交**
```bash
git add cli/src/imageHandler.ts cli/src/imageHandler.test.ts cli/src/types/image.ts
git commit -m "feat: 实现 ImageHandler 类

- 支持图片保存到 E 盘
- 文件大小和类型验证
- 自动创建保存目录
- 单元测试覆盖"
```

---

## Task 3: 扩展 Server 支持二进制消息

**文件:**
- 修改: `cli/src/server.ts`

**步骤 1: 修改客户端状态接口**

找到 `Client` 接口定义（约第 5-10 行），修改为：

```typescript
export interface Client {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: Date;
  imageTransfer?: {
    inProgress: boolean;
    meta: import('./types/image').ImageMeta | null;
    startTime: number;
  };
}
```

**步骤 2: 修改 ClientMessage 接口**

找到 `ClientMessage` 接口定义（约第 19-24 行），修改为：

```typescript
export interface ClientMessage {
  type: 'auth' | 'message' | 'ping' | 'image_meta';
  token?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timestamp?: number;
}
```

**步骤 3: 修改消息处理函数**

找到 `handleMessage` 方法（约第 103-120 行），添加 image_meta 分支：

```typescript
private handleMessage(ws: WebSocket, message: ClientMessage, pingInterval?: NodeJS.Timeout) {
  switch (message.type) {
    case 'auth':
      this.handleAuth(ws, message.token, pingInterval);
      break;

    case 'message':
      this.handleClientMessage(ws, message.content);
      break;

    case 'image_meta':
      this.handleImageMeta(ws, message);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      this.sendError(ws, 'Unknown message type');
  }
}
```

**步骤 4: 添加图片元数据处理器**

在 `handleClientMessage` 方法后添加：

```typescript
private handleImageMeta(ws: WebSocket, meta: any) {
  // 查找客户端
  let client: Client | null = null;
  for (const [id, c] of this.clients) {
    if (c.ws === ws) {
      client = c;
      break;
    }
  }

  if (!client || !client.authenticated) {
    this.sendError(ws, 'Not authenticated');
    return;
  }

  // 设置图片传输状态
  client.imageTransfer = {
    inProgress: true,
    meta: {
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      size: meta.size,
      timestamp: meta.timestamp || Date.now()
    },
    startTime: Date.now()
  };

  console.log(chalk.yellow('📷'), `准备接收图片: ${meta.fileName} (${(meta.size / 1024).toFixed(1)} KB)`);
}
```

**步骤 5: 修改 connection 事件处理**

找到 `ws.on('message'` 处理（约第 74-81 行），修改为：

```typescript
ws.on('message', (data: Buffer, isBinary: boolean) => {
  if (isBinary) {
    this.handleBinaryMessage(ws, data);
  } else {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      this.handleMessage(ws, message);
    } catch (error) {
      this.sendError(ws, 'Invalid message format');
    }
  }
});
```

**步骤 6: 添加二进制消息处理器**

在类中添加新方法：

```typescript
private async handleBinaryMessage(ws: WebSocket, data: Buffer) {
  // 查找客户端
  let client: Client | null = null;
  let clientId: string | null = null;
  for (const [id, c] of this.clients) {
    if (c.ws === ws) {
      client = c;
      clientId = id;
      break;
    }
  }

  if (!client || !client.authenticated) {
    this.sendError(ws, 'Not authenticated');
    return;
  }

  if (!client.imageTransfer?.inProgress || !client.imageTransfer?.meta) {
    this.sendError(ws, '协议错误：未预期的二进制数据');
    return;
  }

  try {
    const { ImageHandler } = await import('./imageHandler');
    const imageHandler = new ImageHandler({
      savePath: 'E:/CodeRemote/Images',
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      createDirectory: true
    });

    const savedPath = await imageHandler.handleImage(
      clientId!,
      data,
      client.imageTransfer.meta
    );

    const response = {
      type: 'image_saved',
      path: savedPath,
      timestamp: Date.now()
    };

    client.ws.send(JSON.stringify(response));
    console.log(chalk.green('✓'), `图片已保存: ${savedPath}`);

    // 重置传输状态
    client.imageTransfer = { inProgress: false, meta: null, startTime: 0 };
  } catch (error: any) {
    const errorResponse = {
      type: 'image_error',
      error: error.message,
      code: this.getErrorCode(error.message),
      timestamp: Date.now()
    };

    client.ws.send(JSON.stringify(errorResponse));
    console.log(chalk.red('✗'), `图片处理失败: ${error.message}`);

    client.imageTransfer = { inProgress: false, meta: null, startTime: 0 };
  }
}

private getErrorCode(message: string): string {
  if (message.includes('图片过大')) return 'TOO_LARGE';
  if (message.includes('不支持的文件类型')) return 'INVALID_TYPE';
  if (message.includes('磁盘空间')) return 'DISK_FULL';
  return 'PROTOCOL_ERROR';
}
```

**步骤 7: 添加图片发送方法**

在类的公共 API 部分添加：

```typescript
async sendImageToClient(clientId: string, imagePath: string): Promise<boolean> {
  const client = this.clients.get(clientId);
  if (!client || !client.authenticated) {
    return false;
  }

  try {
    const { ImageHandler } = await import('./imageHandler');
    const imageHandler = new ImageHandler({
      savePath: 'E:/CodeRemote/Images',
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
      createDirectory: true
    });

    const { buffer, meta } = await imageHandler.loadImage(imagePath);

    // 发送元数据
    client.ws.send(JSON.stringify({
      type: 'image_meta',
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      size: meta.size,
      timestamp: Date.now()
    }));

    // 发送二进制数据
    client.ws.send(buffer);

    console.log(chalk.yellow('📷'), `发送图片到客户端 ${clientId}: ${meta.fileName}`);
    return true;
  } catch (error: any) {
    console.error(chalk.red('发送图片失败:'), error.message);
    return false;
  }
}
```

**步骤 8: 运行编译检查**
```bash
cd E:/code-remote-mvp/cli
npx tsc --noEmit
```
期望: 无错误

**步骤 9: 启动服务器验证**
```bash
cd E:/code-remote-mvp/cli
npx code-remote start --port 8085
```
期望: 服务器正常启动

**步骤 10: 提交**
```bash
git add cli/src/server.ts
git commit -m "feat: 服务器支持二进制图片传输

- 添加图片元数据消息类型
- 实现二进制消息接收处理
- 集成 ImageHandler 保存图片
- 添加发送图片到客户端方法"
```

---

## Task 4: 修改 index.ts 导出 ImageHandler

**文件:**
- 修改: `cli/src/index.ts`

**步骤 1: 添加 ImageHandler 导入**

在文件顶部找到其他导入，添加：
```typescript
export { ImageHandler, ImageConfig } from './imageHandler';
```

**步骤 2: 编译验证**
```bash
cd E:/code-remote-mvp/cli
npx tsc --noEmit
```
期望: 无错误

**步骤 3: 提交**
```bash
git add cli/src/index.ts
git commit -m "feat: 导出 ImageHandler"
```

---

## Task 5: Web 界面添加图片上传功能

**文件:**
- 修改: `web/cr-debug.html`
- 修改: `web/cr.html`

**步骤 1: 修改 cr-debug.html**

找到文件末尾的 `</script>` 标签之前，添加：

```javascript
// 图片上传功能
document.getElementById('testBtn').insertAdjacentHTML('afterend', `
  <input type="file" id="imageInput" accept="image/*" style="display:none">
  <button class="btn btn-primary" onclick="document.getElementById('imageInput').click()" style="margin-top:10px">
    📷 上传图片
  </button>
`);

document.getElementById('imageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !ws || ws.readyState !== 1) {
    log('❌ 请先连接服务器', 'error');
    return;
  }

  log(`📷 开始上传: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, 'info');

  try {
    // 发送元数据
    ws.send(JSON.stringify({
      type: 'image_meta',
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      timestamp: Date.now()
    }));

    // 发送二进制数据
    const arrayBuffer = await file.arrayBuffer();
    ws.send(arrayBuffer);

    log('图片数据已发送', 'info');
  } catch (err) {
    log(`❌ 上传失败: ${err.message}`, 'error');
  }
});
```

**步骤 2: 修改消息处理，添加图片响应处理**

找到 `ws.onmessage` 事件处理中的 `message` case，修改为：

```javascript
if (eventName === 'message') {
  log('📨 收到消息: ' + event.data, 'success');
  try {
    const data = JSON.parse(event.data);
    log('解析后: type=' + data.type, 'info');

    if (data.type === 'auth_success') {
      log('🎉 认证成功！连接已建立', 'success');
    } else if (data.type === 'auth_failed') {
      log('❌ 认证失败：Token 错误', 'error');
    } else if (data.type === 'image_saved') {
      log(`✅ 图片已保存: ${data.path}`, 'success');
    } else if (data.type === 'image_error') {
      log(`❌ 图片错误 [${data.code}]: ${data.error}`, 'error');
    } else if (data.content) {
      log(data.content, 'info');
    }
  } catch (e) {
    log(event.data, 'info');
  }
}
```

**步骤 3: 同样修改 cr.html**

在 cr.html 中添加相同的图片上传功能。

**步骤 4: 浏览器测试**
```
打开 http://localhost:8084/cr-debug.html
点击"📷 上传图片"按钮
选择一张图片
观察日志输出
```

**步骤 5: 提交**
```bash
git add web/cr-debug.html web/cr.html
git commit -m "feat: 添加图片上传功能到 Web 界面

- 文件选择按钮
- 图片元数据发送
- 二进制数据传输
- 图片保存确认显示"
```

---

## Task 6: 添加图片接收显示功能

**文件:**
- 修改: `web/cr-debug.html`
- 修改: `web/cr.html`

**步骤 1: 添加图片显示区域**

在 cr-debug.html 的 `<div class="log" id="log"></div>` 后添加：

```html
<div class="section" style="margin-top:15px">
    <h3>📷 接收的图片</h3>
    <div id="imageContainer" style="background:#16213e;border-radius:8px;padding:15px;text-align:center;">
        <div style="color:#64748b;">等待接收图片...</div>
    </div>
</div>
```

**步骤 2: 添加图片接收处理**

在 WebSocket 消息处理中添加，处理接收到的图片：

```javascript
// 接收图片元数据
let pendingImageMeta = null;

// 在 ws.onmessage 之前添加
ws.binaryType = 'arraybuffer';

// 修改 ws.onmessage 处理
ws.addEventListener('message', (event) => {
  const data = event.data;

  // 处理 ArrayBuffer (图片数据)
  if (data instanceof ArrayBuffer) {
    if (pendingImageMeta) {
      const blob = new Blob([data], { type: pendingImageMeta.mimeType });
      const url = URL.createObjectURL(blob);

      const container = document.getElementById('imageContainer');
      container.innerHTML = `
        <img src="${url}" style="max-width:100%;border-radius:8px;margin-bottom:10px">
        <div style="color:#10b981;font-size:12px;">${pendingImageMeta.fileName} (${(pendingImageMeta.size/1024).toFixed(1)} KB)</div>
      `;

      log(`📷 接收图片: ${pendingImageMeta.fileName}`, 'success');
      pendingImageMeta = null;
    }
    return;
  }

  // 处理 JSON 消息
  try {
    const msg = JSON.parse(data);

    if (msg.type === 'image_meta') {
      pendingImageMeta = msg;
      log(`准备接收图片: ${msg.fileName}`, 'info');
    }

    // ... 其他消息处理
  } catch (e) {
    // ...
  }
});
```

**步骤 3: 测试图片接收**
```
启动服务器后打开 http://localhost:8084/cr-debug.html
连接后，使用 CLI 发送测试图片到客户端
```

**步骤 4: 提交**
```bash
git add web/cr-debug.html web/cr.html
git commit -m "feat: 添加图片接收显示功能

- 接收服务端发送的图片元数据
- 接收二进制图片数据
- 转换为 Blob URL 显示
- 显示图片信息和大小"
```

---

## Task 7: 运行完整测试

**步骤 1: 启动服务**
```bash
cd E:/code-remote-mvp
start.bat
```

**步骤 2: 测试上传**
```
1. 打开 http://localhost:8084/cr-debug.html
2. 连接到服务器
3. 点击"📷 上传图片"
4. 选择一张 < 10MB 的 PNG/JPG 图片
5. 验证 E:/CodeRemote/Images/ 目录中是否有文件
```

**步骤 3: 测试错误处理**
```
1. 尝试上传 10MB+ 图片 (应失败)
2. 尝试上传 .bmp 文件 (应失败)
3. 验证错误消息显示正确
```

**步骤 4: 检查 E 盘**
```
dir E:\CodeRemote\Images
```
期望: 看到上传的图片文件

**步骤 5: 提交测试结果**
```bash
git add .
git commit -m "test: 完成图片传输功能测试

- ✅ 图片上传到 E 盘成功
- ✅ 文件大小限制生效
- ✅ 文件类型验证生效
- ✅ 错误提示友好"
```

---

## Task 8: 更新文档

**文件:**
- 修改: `DEVELOPMENT.md`

**步骤 1: 在 "Working Features" 部分添加**
```markdown
### Working Features
- ✅ Local WiFi WebSocket connection (ws://192.168.x.x:port)
- ✅ External network access via ngrok tunnel
- ✅ iOS Safari WebSocket support
- ✅ Token-based authentication
- ✅ Debug web interface for testing
- ✅ Simple message echo handler
- ✅ Image transfer (bidirectional, up to 10MB)
```

**步骤 2: 在 "Future Improvements" 移除图片相关**
```markdown
## Future Improvements

1. **Auto-reconnect**: Handle connection drops gracefully
2. **Multi-client support**: Multiple phones connected simultaneously
3. **Claude Code Integration**: Actually execute Claude Code commands
4. **Push Notifications**: Alert when server has new messages
5. **Voice Input**: Speech-to-text on mobile
```

**步骤 3: 提交**
```bash
git add DEVELOPMENT.md
git commit -m "docs: 更新开发文档

- 标记图片传输功能已完成
- 更新功能列表
- 移除已实现的改进项"
```

---

## 完成标准

- ✅ 能上传 < 10MB 的 PNG/JPG/GIF/WebP 图片
- ✅ 图片保存到 `E:/CodeRemote/Images/`
- ✅ 正确拒绝超大文件和不支持类型
- ✅ 传输错误时返回友好提示
- ✅ Web 界面能选择和发送图片
- ✅ Web 界面能显示接收到的图片
- ✅ 单元测试覆盖率 > 80%
