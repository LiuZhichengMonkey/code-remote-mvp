/**
 * CodeRemote 外网启动脚本
 * 自动：启动服务 -> 获取 ngrok URL -> 更新配置 -> 构建前端
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CONFIG = {
  WS_PORT: 8085,
  UNIFIED_PORT: 3001,
  TOKEN: 'test123',
  NGROK_API: 'http://127.0.0.1:4040/api/tunnels',
  APP_TSX_PATH: path.join(__dirname, 'chat-ui', 'src', 'App.tsx')
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 检查端口是否被占用
async function isPortInUse(port) {
  try {
    const result = await execAsync(`netstat -ano | findstr ":${port}.*LISTENING"`);
    return result.length > 0;
  } catch {
    return false;
  }
}

// 杀掉占用端口的进程
async function killPort(port) {
  try {
    const result = await execAsync(`netstat -ano | findstr ":${port}"`);
    const lines = result.split('\n').filter(l => l.includes('LISTENING'));
    for (const line of lines) {
      const match = line.trim().match(/\s+(\d+)\s*$/);
      if (match) {
        const pid = match[1];
        log(`  Killing process ${pid} on port ${port}`, 'dim');
        try {
          await execAsync(`taskkill /PID ${pid} /F`);
        } catch (e) {
          // Process may already be gone
        }
      }
    }
    // Wait for port to be released
    await sleep(1000);
  } catch (e) {
    // No process found
  }
}

// 获取 ngrok 隧道 URL
async function getNgrokUrl() {
  return new Promise((resolve, reject) => {
    http.get(CONFIG.NGROK_API, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.tunnels && json.tunnels.length > 0) {
            resolve(json.tunnels[0].public_url);
          } else {
            reject(new Error('No tunnels found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 更新 App.tsx 中的默认 URL
function updateDefaultUrl(ngrokUrl) {
  const wsUrl = ngrokUrl.replace('https://', 'wss://').replace('http://', 'ws://');

  let content = fs.readFileSync(CONFIG.APP_TSX_PATH, 'utf8');

  // 更新 DEFAULT_WS_URL
  content = content.replace(
    /const DEFAULT_WS_URL = ['"][^'"]+['"];/,
    `const DEFAULT_WS_URL = '${wsUrl}';`
  );

  fs.writeFileSync(CONFIG.APP_TSX_PATH, content);
  return wsUrl;
}

// 构建前端
async function buildFrontend() {
  log('\n[5/5] Building frontend...', 'cyan');

  return new Promise((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], {
      cwd: path.join(__dirname, 'chat-ui'),
      shell: true,
      stdio: 'inherit'
    });

    build.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with code ${code}`));
    });
  });
}

// 启动后台服务
function startService(name, cmd, cwd) {
  log(`  Starting ${name}...`, 'dim');
  // 在 Windows 上使用 start 命令启动独立的进程
  const fullCmd = process.platform === 'win32'
    ? `start /min cmd /c "${cmd}"`
    : cmd;
  const proc = spawn(fullCmd, { cwd, shell: true, detached: true });
  proc.unref();
  return proc;
}

async function main() {
  console.log('\n' + '='.repeat(50));
  log('  CodeRemote External Network Launcher', 'cyan');
  console.log('='.repeat(50) + '\n');

  // Step 1: 清理端口
  log('[1/5] Cleaning up ports...', 'yellow');
  await killPort(CONFIG.WS_PORT);
  await killPort(CONFIG.UNIFIED_PORT);
  await sleep(500);

  // Step 2: 启动 WebSocket 服务器
  log('[2/5] Starting WebSocket server...', 'yellow');
  startService('WebSocket Server', `node dist/index.js start -p ${CONFIG.WS_PORT} -t ${CONFIG.TOKEN} --no-tunnel`, path.join(__dirname, 'cli'));

  // Step 3: 启动统一服务器
  log('[3/5] Starting Unified server...', 'yellow');
  await sleep(2000);
  startService('Unified Server', 'node unified-server.js', path.join(__dirname, 'cli'));

  // Step 4: 获取 ngrok URL
  log('[4/5] Detecting ngrok tunnel...', 'yellow');
  await sleep(2000);

  let ngrokUrl;
  try {
    ngrokUrl = await getNgrokUrl();
    log(`  Found ngrok URL: ${ngrokUrl}`, 'green');

    // 更新配置
    const wsUrl = updateDefaultUrl(ngrokUrl);
    log(`  Updated DEFAULT_WS_URL: ${wsUrl}`, 'green');

    // 构建前端
    await buildFrontend();

    console.log('\n' + '='.repeat(50));
    log('  READY!', 'green');
    console.log('='.repeat(50));
    console.log(`\n  Public URL: ${ngrokUrl}`);
    console.log(`  WebSocket:  ${wsUrl}`);
    console.log(`  Token:      ${CONFIG.TOKEN}`);
    console.log('\n  Open the URL on your mobile device!');
    console.log('='.repeat(50) + '\n');

  } catch (e) {
    log(`  Ngrok not detected: ${e.message}`, 'red');
    log('  Please start ngrok manually: ngrok http 3001', 'yellow');

    console.log('\n' + '='.repeat(50));
    log('  Services started (ngrok not running)', 'yellow');
    console.log('='.repeat(50));
    console.log(`\n  Local URL: http://localhost:${CONFIG.UNIFIED_PORT}`);
    console.log(`  Token:     ${CONFIG.TOKEN}`);
    console.log('\n  Run: ngrok http 3001');
    console.log('  Then run this script again to update config.');
    console.log('='.repeat(50) + '\n');
  }
}

main().catch(console.error);
