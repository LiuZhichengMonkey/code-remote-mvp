# 图片传输功能设计文档

**日期:** 2025-03-06
**作者:** Claude
**状态:** 设计完成，待实现

---

## 1. 功能概述

为 CodeRemote 添加双向图片传输功能，支持：
- 手机 → 电脑：上传图片到 E 盘
- 电脑 → 手机：发送图片到手机显示
- 支持格式：PNG, JPEG, GIF, WebP
- 文件大小限制：10MB

---

## 2. 整体架构

```
┌─────────────┐                    ┌─────────────┐
│   手机端     │                    │   电脑端     │
│  (Client)   │                    │   (Server)   │
└─────────────┘                    └─────────────┘
      │                                    │
      │ 1. 选择/拍摄图片                      │
      │    读取为 ArrayBuffer                  │
      │                                    │
      │ 2. 发送图片帧  ──────────────────────▶│ 3. 接收二进制数据
      │    WebSocket.send(arraybuffer)        │    ws.on('message', data, isBinary)
      │                                    │
      │ 4. 接收确认     ◀──────────────────────│ 5. 保存到 E:/CodeRemote/Images/
      │    {type: 'image_saved', path: '...'}   │    返回保存路径
      │                                    │
      │ 6. 显示成功提示                       │
      │                                    │
└─────────────┘                    └─────────────┘
```

---

## 3. 消息协议

### 3.1 客户端 → 服务端（上传图片）

```typescript
// 步骤 1：发送元数据（JSON 字符串）
{
  type: 'image_meta',
  fileName: 'screenshot.png',
  mimeType: 'image/png',
  size: 12345,
  timestamp: 1234567890
}

// 步骤 2：发送二进制数据（Buffer）
<ArrayBuffer containing image data>
```

### 3.2 服务端响应

```typescript
// 成功
{
  type: 'image_saved',
  path: 'E:\\CodeRemote\\Images\\screenshot_20250306_143020.png',
  timestamp: 1234567890
}

// 失败
{
  type: 'image_error',
  error: '错误描述',
  code: 'TOO_LARGE | INVALID_TYPE | TIMEOUT | DISK_FULL',
  timestamp: 1234567890
}
```

### 3.3 服务端 → 客户端（发送图片）

```typescript
// 步骤 1：发送元数据
{
  type: 'image_meta',
  fileName: 'output.png',
  mimeType: 'image/png',
  size: 54321,
  timestamp: 1234567890
}

// 步骤 2：发送二进制数据
<Buffer>
```

---

## 4. 组件设计

### 4.1 ImageHandler (新增)

```typescript
class ImageHandler {
  private savePath: string;
  private maxSize: number;
  private allowedTypes: string[];

  constructor(config: ImageConfig) {
    this.savePath = config.savePath || 'E:/CodeRemote/Images';
    this.maxSize = config.maxSize || 10 * 1024 * 1024; // 10MB
    this.allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  }

  // 处理接收到的图片
  async handleImage(
    clientId: string,
    buffer: Buffer,
    meta: ImageMeta
  ): Promise<string>;

  // 从文件读取图片
  async loadImage(filePath: string): Promise<{ buffer: Buffer; meta: ImageMeta }>;

  // 生成唯一文件名
  generateFileName(originalName: string): string;
}

interface ImageMeta {
  fileName: string;
  mimeType: string;
  size: number;
  timestamp?: number;
}
```

### 4.2 Server.ts 修改

```typescript
// 扩展消息类型
interface ClientMessage {
  type: 'auth' | 'message' | 'ping' | 'image_meta';
  token?: string;
  content?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  timestamp?: number;
}

// 扩展客户端状态
interface Client {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  connectedAt: Date;
  imageTransfer?: {
    inProgress: boolean;
    meta: ImageMeta | null;
    startTime: number;
  };
}

// 处理二进制消息
ws.on('message', (data: Buffer, isBinary: boolean) => {
  if (isBinary) {
    this.handleBinaryMessage(ws, data);
  } else {
    const message: ClientMessage = JSON.parse(data.toString());
    this.handleMessage(ws, message);
  }
});
```

### 4.3 Web 客户端 (HTML)

```typescript
// 发送图片
async function sendImage(file: File) {
  const arrayBuffer = await file.arrayBuffer();

  // 发送元数据
  ws.send(JSON.stringify({
    type: 'image_meta',
    fileName: file.name,
    mimeType: file.type,
    size: file.size
  }));

  // 发送二进制数据
  ws.send(arrayBuffer);
}

// 接收图片
ws.binaryType = 'arraybuffer';
ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    // 转换为 Blob URL 显示
    const blob = new Blob([event.data], { type: pendingMeta.mimeType });
    const url = URL.createObjectURL(blob);
    displayImage(url);
  } else {
    // 处理 JSON 消息
    const msg = JSON.parse(event.data);
    handleJsonMessage(msg);
  }
};
```

---

## 5. 数据流

### 5.1 上传流程（手机 → 电脑）

```
1. 用户选择图片
   ↓
2. 文件读取为 ArrayBuffer
   ↓
3. 验证文件大小和类型
   ↓
4. 发送元数据 { type: 'image_meta', ... }
   ↓
5. 服务端验证元数据，保存到客户端状态
   ↓
6. 发送二进制数据 ws.send(arrayBuffer)
   ↓
7. 服务端接收 Buffer，写入文件
   ↓
8. 返回成功响应 { type: 'image_saved', path: '...' }
   ↓
9. 客户端显示成功提示
```

### 5.2 下载流程（电脑 → 手机）

```
1. 服务端读取图片文件
   ↓
2. 发送元数据 { type: 'image_meta', ... }
   ↓
3. 客户端准备接收，显示"接收中..."
   ↓
4. 发送二进制数据
   ↓
5. 客户端接收 ArrayBuffer
   ↓
6. 转换为 Blob URL
   ↓
7. 显示图片 <img src={blobUrl}>
```

---

## 6. 错误处理

| 错误类型 | 错误代码 | 处理方式 |
|---------|---------|---------|
| 文件过大 | TOO_LARGE | 拒绝，返回友好提示 |
| 不支持的类型 | INVALID_TYPE | 拒绝，返回友好提示 |
| 传输超时 | TIMEOUT | 清理状态，返回超时错误 |
| 磁盘空间不足 | DISK_FULL | 返回错误，提示清理空间 |
| 协议错误 | PROTOCOL_ERROR | 返回错误，重置状态 |

---

## 7. 配置

```typescript
interface ServerConfig {
  image: {
    savePath: string;           // E:/CodeRemote/Images
    maxSize: number;            // 10485760 (10MB)
    allowedTypes: string[];     // ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    createDirectory: boolean;   // true - 自动创建目录
  };
}
```

---

## 8. 测试计划

### 8.1 单元测试
- ImageHandler.handleImage() - 正常保存
- ImageHandler.handleImage() - 文件过大
- ImageHandler.handleImage() - 类型不支持
- ImageHandler.generateFileName() - 文件名格式

### 8.2 集成测试
- 完整上传流程
- 完整下载流程
- 错误场景覆盖

### 8.3 手动测试
- 浏览器上传图片
- 检查 E:/CodeRemote/Images/ 目录
- 测试边界情况

---

## 9. 文件变更清单

### 新增文件
- `cli/src/imageHandler.ts` - 图片处理逻辑
- `cli/src/types/image.ts` - 图片相关类型定义

### 修改文件
- `cli/src/server.ts` - 添加二进制消息处理
- `cli/src/index.ts` - 添加图片配置和 handler 初始化
- `web/cr-debug.html` - 添加图片上传/显示功能
- `web/cr.html` - 添加图片上传/显示功能
- `web/mobile.html` - 添加图片上传/显示功能

---

## 10. 实现优先级

1. **P0 - 核心功能**
   - ImageHandler 基础实现
   - 服务端二进制消息接收
   - 文件保存到 E 盘

2. **P1 - 客户端**
   - Web 界面图片上传
   - 图片显示功能

3. **P2 - 增强**
   - 进度显示
   - 缩略图预览
   - 图片压缩选项

---

## 11. 实现后接口示例

```typescript
// 服务端使用示例
const imageHandler = new ImageHandler({
  savePath: 'E:/CodeRemote/Images',
  maxSize: 10 * 1024 * 1024
});

server.onImage(async (clientId, buffer, meta) => {
  const path = await imageHandler.handleImage(clientId, buffer, meta);
  server.sendToClient(clientId, JSON.stringify({
    type: 'image_saved',
    path
  }));
});

// 客户端使用示例
function uploadImage(file) {
  ws.send(JSON.stringify({
    type: 'image_meta',
    fileName: file.name,
    mimeType: file.type,
    size: file.size
  }));
  ws.send(await file.arrayBuffer());
}
```

---

## 12. 完成标准

- ✅ 能够上传 < 10MB 的 PNG/JPG 图片到 E 盘
- ✅ 正确拒绝超大文件和不支持类型
- ✅ 传输错误时返回友好提示
- ✅ Web 界面能够选择和发送图片
- ✅ Web 界面能够显示接收到的图片
- ✅ 单元测试覆盖率 > 80%
