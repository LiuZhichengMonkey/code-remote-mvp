/**
 * 统一服务器 - 同时处理 HTTP 静态文件和 WebSocket 代理
 * 用于 ngrok 单隧道外网访问
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// 配置
const HTTP_PORT = 3001;
const WS_TARGET = 'ws://localhost:8085';  // 目标 WebSocket 服务器
const STATIC_DIR = path.join(__dirname, 'chat-ui', 'dist');

// MIME 类型
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);

  // 处理 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 确定文件路径
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);

  // 检查文件是否存在
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // 如果文件不存在，返回 index.html（SPA 路由）
      filePath = path.join(STATIC_DIR, 'index.html');
    }

    // 获取 MIME 类型
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // 读取并返回文件
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

// 创建 WebSocket 服务器（用于代理）
const wss = new WebSocket.Server({ noServer: true });

// 处理 WebSocket 升级请求
server.on('upgrade', (req, socket, head) => {
  console.log(`[WS] Upgrade request: ${req.url}`);

  // 拦截 WebSocket 升级
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// 处理 WebSocket 连接（代理到目标服务器）
wss.on('connection', (clientWs, req) => {
  console.log('[WS] Client connected, proxying to target...');

  // 连接到目标 WebSocket 服务器
  const targetWs = new WebSocket(WS_TARGET);

  targetWs.on('open', () => {
    console.log('[WS] Connected to target server');
  });

  // 客户端 -> 目标服务器
  clientWs.on('message', (data, isBinary) => {
    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(data, { binary: isBinary });
    }
  });

  // 目标服务器 -> 客户端
  targetWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  // 处理关闭
  clientWs.on('close', () => {
    console.log('[WS] Client disconnected');
    targetWs.close();
  });

  targetWs.on('close', () => {
    console.log('[WS] Target disconnected');
    clientWs.close();
  });

  // 处理错误
  clientWs.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    targetWs.close();
  });

  targetWs.on('error', (err) => {
    console.error('[WS] Target error:', err.message);
    clientWs.close();
  });
});

// 启动服务器
server.listen(HTTP_PORT, () => {
  console.log('========================================');
  console.log('  Unified Server Started');
  console.log('========================================');
  console.log(`  HTTP:  http://localhost:${HTTP_PORT}`);
  console.log(`  WS:    ws://localhost:${HTTP_PORT} -> ${WS_TARGET}`);
  console.log(`  Static: ${STATIC_DIR}`);
  console.log('========================================');
  console.log('');
  console.log('For ngrok, run:');
  console.log(`  ngrok http ${HTTP_PORT}`);
});
