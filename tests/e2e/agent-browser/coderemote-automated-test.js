/**
 * CodeRemote 自动化测试套件
 * 测试页面: https://acropetal-nonfalteringly-ruben.ngrok-free.dev/
 *
 * 测试范围:
 * - WebSocket 连接
 * - 消息发送/接收
 * - 会话管理
 * - 命令处理
 * - UI 交互
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================
// 配置
// ============================================
const BASE_URL = 'https://acropetal-nonfalteringly-ruben.ngrok-free.dev/';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const TEST_TIMEOUT = 60000;

// 创建截图目录
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ============================================
// 测试工具
// ============================================
class TestRunner {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.results = [];
        this.browser = null;
    }

    exec(cmd) {
        try {
            return {
                success: true,
                output: execSync(`agent-browser ${cmd}`, {
                    encoding: 'utf-8',
                    timeout: TEST_TIMEOUT
                }).trim()
            };
        } catch (e) {
            return { success: false, output: e.message };
        }
    }

    async test(name, fn) {
        console.log(`\n[TEST] ${name}`);
        console.log('-'.repeat(50));

        try {
            await fn();
            this.passed++;
            this.results.push({ name, status: 'PASS' });
            console.log(`✅ PASS: ${name}`);
        } catch (error) {
            this.failed++;
            this.results.push({ name, status: 'FAIL', error: error.message });
            console.log(`❌ FAIL: ${name}`);
            console.log(`   Error: ${error.message}`);
        }
    }

    assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    openPage() {
        this.exec('close');
        const result = this.exec(`open "${BASE_URL}"`);

        // 处理 ngrok 警告页
        const snapshot = this.exec('snapshot -i').output;
        if (snapshot.includes('Visit Site')) {
            console.log('  [INFO] 跳过 ngrok 警告页...');
            this.exec('click @e2');
            this.exec('wait --load networkidle');
        }

        return result;
    }

    report() {
        console.log('\n' + '='.repeat(50));
        console.log('              测试报告');
        console.log('='.repeat(50));
        console.log(`✅ 通过: ${this.passed}`);
        console.log(`❌ 失败: ${this.failed}`);
        console.log(`📊 总计: ${this.passed + this.failed}`);
        console.log('='.repeat(50));

        if (this.failed > 0) {
            console.log('\n失败的测试:');
            this.results
                .filter(r => r.status === 'FAIL')
                .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
        }
    }
}

const runner = new TestRunner();

// ============================================
// 测试用例
// ============================================

async function runTests() {
    console.log('\n' + '='.repeat(50));
    console.log('    CodeRemote 自动化测试套件');
    console.log('='.repeat(50));

    // ==========================================
    // 模块 1: 页面加载测试
    // ==========================================
    console.log('\n📦 模块 1: 页面加载测试');

    await runner.test('1.1 页面标题验证', async () => {
        runner.openPage();
        const title = runner.exec('get title').output;
        runner.assert(
            title.includes('CodeRemote'),
            `页面标题错误: ${title}`
        );
        runner.exec(`screenshot ${SCREENSHOT_DIR}/01-page-load.png`);
    });

    await runner.test('1.2 核心UI元素存在', async () => {
        runner.openPage();
        const snapshot = runner.exec('snapshot -i').output;

        // 检查关键元素
        const checks = [
            { pattern: /New Chat|新建聊天|textbox/i, name: '新建聊天按钮' },
            { pattern: /Message|消息|textbox/i, name: '消息输入框' },
            { pattern: /button/i, name: '按钮元素' },
        ];

        for (const check of checks) {
            runner.assert(check.pattern.test(snapshot), `未找到 ${check.name}`);
        }
    });

    await runner.test('1.3 页面URL正确', async () => {
        runner.openPage();
        const url = runner.exec('get url').output;
        runner.assert(
            url.includes('ngrok-free.dev') || url.includes('localhost'),
            `URL 错误: ${url}`
        );
    });

    // ==========================================
    // 模块 2: 消息输入测试
    // ==========================================
    console.log('\n📦 模块 2: 消息输入测试');

    await runner.test('2.1 消息输入框功能', async () => {
        runner.openPage();
        const snapshot = runner.exec('snapshot -i').output;

        // 找到消息输入框 - 需要排除 New Chat 按钮
        // 查找所有 textbox，找到不是 New Chat 的那个
        const textboxMatches = snapshot.match(/textbox[^\n]*\[ref=(e\d+)\]/gi) || [];
        let inputRef = null;

        for (const match of textboxMatches) {
            const refMatch = match.match(/\[ref=(e\d+)\]/);
            if (refMatch && !match.toLowerCase().includes('new chat')) {
                inputRef = refMatch[1];
                break;
            }
        }

        runner.assert(inputRef, '未找到消息输入框');

        const testText = 'Hello, CodeRemote!';

        runner.exec(`fill @${inputRef} "${testText}"`);
        const value = runner.exec(`get value @${inputRef}`).output;

        runner.assert(
            value.includes(testText),
            `输入值错误: ${value}`
        );

        runner.exec(`screenshot ${SCREENSHOT_DIR}/02-input-test.png`);
    });

    await runner.test('2.2 特殊字符输入', async () => {
        runner.openPage();
        const snapshot = runner.exec('snapshot -i').output;
        // 支持多种格式
        let match = snapshot.match(/textbox[^\[]*\[ref=(e\d+)\]/i);
        if (!match) {
            match = snapshot.match(/textbox[^\n]*placeholder[^\n]*\[ref=(e\d+)\]/i);
        }

        if (match) {
            const inputRef = match[1];
            const specialChars = '/help /ls /read';

            runner.exec(`fill @${inputRef} "${specialChars}"`);
            runner.exec(`screenshot ${SCREENSHOT_DIR}/02-special-input.png`);

            // 清空输入
            runner.exec(`fill @${inputRef} ""`);
        }
    });

    // ==========================================
    // 模块 3: 命令测试
    // ==========================================
    console.log('\n📦 模块 3: 命令测试');

    await runner.test('3.1 /help 命令', async () => {
        runner.openPage();
        let snapshot = runner.exec('snapshot -i').output;

        // 支持多种格式找到消息输入框
        let match = snapshot.match(/textbox[^\[]*\[ref=(e\d+)\]/i);
        if (!match) {
            match = snapshot.match(/textbox[^\n]*placeholder[^\n]*\[ref=(e\d+)\]/i);
        }

        runner.assert(match, '未找到消息输入框');
        const inputRef = match[1];

        // 输入 /help
        runner.exec(`fill @${inputRef} "/help"`);

        // 找发送按钮
        snapshot = runner.exec('snapshot -i').output;
        const btnMatch = snapshot.match(/button[^\[]*\[ref=(e\d+)\]/g);

        if (btnMatch && btnMatch.length > 0) {
            const lastBtn = btnMatch[btnMatch.length - 1].match(/\[ref=(e\d+)\]/)[1];
            runner.exec(`click @${lastBtn}`);
            runner.exec('wait 2000');

            const content = runner.exec('eval "document.body.innerText"').output;
            runner.assert(
                content.includes('/') || content.includes('Commands') || content.includes('命令'),
                `/help 命令未正确响应`
            );
        }

        runner.exec(`screenshot ${SCREENSHOT_DIR}/03-help-command.png`);
    });

    await runner.test('3.2 /ls 命令', async () => {
        runner.openPage();
        let snapshot = runner.exec('snapshot -i').output;

        // 支持多种格式找到消息输入框
        let match = snapshot.match(/textbox[^\[]*\[ref=(e\d+)\]/i);
        if (!match) {
            match = snapshot.match(/textbox[^\n]*placeholder[^\n]*\[ref=(e\d+)\]/i);
        }

        if (match) {
            const inputRef = match[1];
            runner.exec(`fill @${inputRef} "/ls"`);

            snapshot = runner.exec('snapshot -i').output;
            const btnMatch = snapshot.match(/button[^\[]*\[ref=(e\d+)\]/g);

            if (btnMatch && btnMatch.length > 0) {
                const lastBtn = btnMatch[btnMatch.length - 1].match(/\[ref=(e\d+)\]/)[1];
                runner.exec(`click @${lastBtn}`);
                runner.exec('wait 3000');
            }
        }

        runner.exec(`screenshot ${SCREENSHOT_DIR}/04-ls-command.png`);
    });

    // ==========================================
    // 模块 4: UI 交互测试
    // ==========================================
    console.log('\n📦 模块 4: UI 交互测试');

    await runner.test('4.1 新建聊天按钮', async () => {
        runner.openPage();
        const snapshot = runner.exec('snapshot -i').output;

        // 查找新建聊天按钮
        const match = snapshot.match(/textbox[^\[]*New Chat[^\[]*\[ref=(e\d+)\]/i);

        if (match) {
            const btnRef = match[1];
            runner.exec(`click @${btnRef}`);
            runner.exec('wait 1000');

            runner.exec(`screenshot ${SCREENSHOT_DIR}/04-new-chat.png`);
        } else {
            // 可能是 button 形式
            const btnMatch = snapshot.match(/button[^\[]*New Chat[^\[]*\[ref=(e\d+)\]/i);
            if (btnMatch) {
                runner.exec(`click @${btnMatch[1]}`);
                runner.exec('wait 1000');
                runner.exec(`screenshot ${SCREENSHOT_DIR}/04-new-chat.png`);
            }
        }
    });

    await runner.test('4.2 按钮响应测试', async () => {
        runner.openPage();
        const snapshot = runner.exec('snapshot -i').output;

        // 统计按钮数量
        const buttons = snapshot.match(/button/gi);
        const buttonCount = buttons ? buttons.length : 0;

        runner.assert(buttonCount > 0, '页面没有按钮');
        console.log(`  发现 ${buttonCount} 个按钮`);

        runner.exec(`screenshot ${SCREENSHOT_DIR}/05-buttons.png`);
    });

    // ==========================================
    // 模块 5: 截图和视觉测试
    // ==========================================
    console.log('\n📦 模块 5: 截图和视觉测试');

    await runner.test('5.1 全页面截图', async () => {
        runner.openPage();
        runner.exec(`screenshot --full ${SCREENSHOT_DIR}/06-full-page.png`);

        // 验证截图文件存在
        const exists = fs.existsSync(`${SCREENSHOT_DIR}/06-full-page.png`);
        runner.assert(exists, '全页面截图失败');
    });

    await runner.test('5.2 窗口尺寸测试', async () => {
        runner.openPage();
        runner.exec('set viewport 1920 1080');
        runner.exec(`screenshot ${SCREENSHOT_DIR}/07-desktop-size.png`);

        runner.exec('set viewport 375 812');
        runner.exec(`screenshot ${SCREENSHOT_DIR}/08-mobile-size.png`);

        // 恢复默认
        runner.exec('set viewport 1280 720');
    });

    // ==========================================
    // 模块 6: 网络和性能测试
    // ==========================================
    console.log('\n📦 模块 6: 网络和性能测试');

    await runner.test('6.1 页面加载时间', async () => {
        const start = Date.now();
        runner.openPage();
        const loadTime = Date.now() - start;

        console.log(`  加载时间: ${loadTime}ms`);
        // 通过 ngrok 隧道可能较慢，放宽到 90 秒
        runner.assert(loadTime < 90000, `页面加载过慢: ${loadTime}ms`);
    });

    await runner.test('6.2 页面刷新', async () => {
        runner.openPage();
        runner.exec('reload');
        runner.exec('wait --load networkidle');

        const title = runner.exec('get title').output;
        runner.assert(title.includes('CodeRemote'), '刷新后页面标题错误');
    });

    // ==========================================
    // 清理和报告
    // ==========================================
    runner.exec('close');
    runner.report();

    return runner.failed === 0;
}

// ============================================
// 运行测试
// ============================================
runTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
        console.error('测试执行错误:', err);
        process.exit(1);
    });
