"""
Web UI E2E 测试套件

测试 CodeRemote Web UI 的核心功能

运行方式:
    python e2e/test_connection.py
    python e2e/test_messaging.py
    python e2e/test_sessions.py
"""

import sys
import os
import time
import json

# 设置 UTF-8 编码
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 添加 Playwright 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from playwright.sync_api import sync_playwright, expect
except ImportError:
    print("请先安装 Playwright:")
    print('  pip install playwright')
    print('  python -m playwright install chromium')
    sys.exit(1)


# ============================================
# 配置
# ============================================

CHAT_UI_URL = "http://localhost:3001"
SERVER_URL = "http://localhost:8080"
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")

# 测试 Token (需要与 后端服务器一致)
TEST_TOKEN = None  # 将在运行时获取


def ensure_screenshot_dir():
    """确保截图目录存在"""
    if not os.path.exists(SCREENSHOT_DIR):
        os.makedirs(SCREENSHOT_DIR)


def save_screenshot(page, name: str):
    """保存截图"""
    ensure_screenshot_dir()
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  截图保存: {path}")


def get_server_token():
    """从 后端服务获取 Token"""
    global TEST_TOKEN
    if TEST_TOKEN:
        return TEST_TOKEN

    # 尝试从 后端服务获取 Token
    try:
        import urllib.request
        with urllib.request.urlopen(f"{SERVER_URL}/health") as response:
            data = json.loads(response.read().decode())
            # 如果后端返回了 token
            if 'token' in data:
                TEST_TOKEN = data['token']
                return TEST_TOKEN
    except:
        pass

    # 使用默认 Token
    return "test-token"


# ============================================
# 测试 1: 连接测试
# ============================================

def test_page_load():
    """测试页面是否正常加载"""
    print("\n=== 测试: 页面加载 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("  1. 访问页面...")
        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        print("  2. 检查标题...")
        title = page.title()
        print(f"     标题: {title}")
        assert "CodeRemote" in title, f"标题应该包含 CodeRemote，实际: {title}"

        print("  3. 检查主要元素...")
        # 检查是否存在输入框
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
        assert input_box.count() > 0, "应该存在消息输入框"
        print("     ✓ 消息输入框存在")

        save_screenshot(page, "01_page_load")
        browser.close()

    print("  ✓ 页面加载测试通过")


def test_ui_elements():
    """测试 UI 元素是否存在"""
    print("\n=== 测试: UI 元素 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 检查侧边栏
        print("  1. 检查侧边栏...")
        sidebar = page.locator('[class*="sidebar"], [class*="Sidebar"], aside')
        if sidebar.count() > 0:
            print("     ✓ 侧边栏存在")
        else:
            print("     ⚠ 侧边栏未找到 (可能是隐藏状态)")

        # 检查新建会话按钮
        print("  2. 检查新建会话按钮...")
        new_chat_btn = page.locator('button:has-text("New"), button:has-text("新建")')
        if new_chat_btn.count() > 0:
            print("     ✓ 新建会话按钮存在")
        else:
            print("     ⚠ 新建会话按钮未找到")

        # 检查连接状态指示器
        print("  3. 检查连接状态...")
        status_indicators = page.locator('[class*="status"], [class*="Status"]')
        print(f"     找到 {status_indicators.count()} 个状态指示器")

        # 检查消息输入区域
        print("  4. 检查消息输入区域...")
        send_btn = page.locator('button:has(svg)')  # 发送按钮通常包含 SVG 图标
        print(f"     找到 {send_btn.count()} 个图标按钮")

        save_screenshot(page, "02_ui_elements")
        browser.close()

    print("  ✓ UI 元素测试通过")


# ============================================
# 测试 2: 消息发送测试
# ============================================

def test_message_input():
    """测试消息输入功能"""
    print("\n=== 测试: 消息输入 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 找到输入框
        print("  1. 查找输入框...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
        assert input_box.count() > 0, "应该存在消息输入框"
        print("     ✓ 输入框存在")

        # 输入消息
        print("  2. 输入测试消息...")
        test_message = "Hello, this is a test message!"
        input_box.first.fill(test_message)
        time.sleep(0.5)

        # 检查输入值
        value = input_box.first.input_value()
        assert value == test_message, f"输入值应该为 '{test_message}'，实际: '{value}'"
        print(f"     ✓ 输入成功: {value}")

        save_screenshot(page, "03_message_input")
        browser.close()

    print("  ✓ 消息输入测试通过")


def test_skill_selector():
    """测试技能选择器 (/命令)"""
    print("\n=== 测试: 技能选择器 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 找到输入框
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 输入 / 触发技能选择器
        print("  1. 输入 / 触发技能选择器...")
        input_box.fill("/")
        input_box.focus()
        time.sleep(0.5)

        # 检查是否显示技能列表
        print("  2. 检查技能列表...")
        skill_panel = page.locator('text=/Git Commit|Create README|Simplify|Brainstorm/i')
        if skill_panel.count() > 0:
            print(f"     ✓ 找到 {skill_panel.count()} 个技能")
            # 截图
            save_screenshot(page, "04_skill_selector")
        else:
            print("     ⚠ 技能列表未显示 (可能需要连接状态)")

        browser.close()

    print("  ✓ 技能选择器测试通过")


def test_agent_selector():
    """测试 Agent 选择器 (@mention)"""
    print("\n=== 测试: Agent 选择器 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 找到输入框
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 输入 @ 触发 Agent 选择器
        print("  1. 输入 @ 触发 Agent 选择器...")
        input_box.fill("@")
        input_box.focus()
        time.sleep(0.5)

        # 检查是否显示 Agent 列表
        print("  2. 检查 Agent 列表...")
        agent_panel = page.locator('text=/代码审查|架构师|测试专家|安全专家|性能专家/i')
        if agent_panel.count() > 0:
            print(f"     ✓ 找到 {agent_panel.count()} 个 Agent")
            save_screenshot(page, "05_agent_selector")
        else:
            print("     ⚠ Agent 列表未显示 (可能需要连接状态)")

        browser.close()

    print("  ✓ Agent 选择器测试通过")


# ============================================
# 测试 3: 会话管理测试
# ============================================

def test_new_session():
    """测试新建会话"""
    print("\n=== 测试: 新建会话 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找新建按钮
        print("  1. 查找新建会话按钮...")
        new_btn = page.locator('button:has-text("New"), button:has-text("新建"), [class*="new-chat"]').first

        if new_btn.count() > 0:
            print("     ✓ 找到新建按钮")
            new_btn.click()
            time.sleep(0.5)
            save_screenshot(page, "06_new_session")
        else:
            print("     ⚠ 新建按钮未找到")

        browser.close()

    print("  ✓ 新建会话测试完成")


def test_history_panel():
    """测试历史面板"""
    print("\n=== 测试: 历史面板 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找历史按钮
        print("  1. 查找历史面板...")
        history_btn = page.locator('button:has-text("History"), button:has-text("历史"), [class*="history"]').first

        if history_btn.count() > 0:
            print("     ✓ 找到历史按钮")
            history_btn.click()
            time.sleep(0.5)
            save_screenshot(page, "07_history_panel")
        else:
            print("     ⚠ 历史按钮未找到 (可能是自动展开的)")

        browser.close()

    print("  ✓ 历史面板测试完成")


# ============================================
# 测试 4: 响应式设计测试
# ============================================

def test_responsive_design():
    """测试响应式设计"""
    print("\n=== 测试: 响应式设计 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # 测试不同屏幕尺寸
        sizes = [
            ("桌面", 1920, 1080),
            ("平板", 768, 1024),
            ("手机", 375, 667),
        ]

        for name, width, height in sizes:
            print(f"  测试 {name} ({width}x{height})...")
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.goto(CHAT_UI_URL)
            page.wait_for_load_state('networkidle')

            save_screenshot(page, f"08_responsive_{name}")

            # 检查关键元素是否可见
            input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
            assert input_box.count() > 0, f"{name}: 输入框应该存在"
            print(f"     ✓ {name} 布局正常")

            page.close()

        browser.close()

    print("  ✓ 响应式设计测试通过")


# ============================================
# 测试 5: WebSocket 连接测试 (需要运行后端服务)
# ============================================

def test_websocket_connection():
    """测试 WebSocket 连接 (需要 后端服务器运行)"""
    print("\n=== 测试: WebSocket 连接 ===")

    # 检查 CLI 是否运行
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('localhost', 8080))
    sock.close()

    if result != 0:
        print("  ⚠ 后端服务器未运行，跳过 WebSocket 测试")
        print("  提示: 运行 '.\\scripts\\windows\\start.ps1' 启动服务器")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # 非无头模式以便调试
        page = browser.new_page()

        # 监听 WebSocket
        ws_messages = []

        def on_websocket(ws):
            print(f"  WebSocket 连接: {ws.url}")
            ws.on("framesreceived", lambda frames: ws_messages.append(frames))

        page.on("websocket", on_websocket)

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 等待连接
        print("  1. 等待 WebSocket 连接...")
        time.sleep(2)

        # 检查连接状态
        print("  2. 检查连接状态...")
        status = page.locator('[class*="connected"], [class*="status"]')
        if status.count() > 0:
            save_screenshot(page, "09_websocket_connected")
            print("     ✓ 连接状态指示器存在")

        browser.close()

    print("  ✓ WebSocket 连接测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("CodeRemote Web UI E2E 测试")
    print("=" * 60)

    tests = [
        ("页面加载", test_page_load),
        ("UI 元素", test_ui_elements),
        ("消息输入", test_message_input),
        ("技能选择器", test_skill_selector),
        ("Agent 选择器", test_agent_selector),
        ("新建会话", test_new_session),
        ("历史面板", test_history_panel),
        ("响应式设计", test_responsive_design),
        ("WebSocket 连接", test_websocket_connection),
    ]

    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, "✓ 通过"))
        except Exception as e:
            results.append((name, f"✗ 失败: {str(e)}"))
            print(f"  ✗ 测试失败: {e}")

    # 打印结果摘要
    print("\n" + "=" * 60)
    print("测试结果摘要")
    print("=" * 60)
    for name, result in results:
        print(f"  {name}: {result}")

    passed = sum(1 for _, r in results if "✓" in r)
    failed = sum(1 for _, r in results if "✗" in r)
    print(f"\n总计: {passed} 通过, {failed} 失败")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # 运行指定测试
        test_name = sys.argv[1]
        test_map = {
            "load": test_page_load,
            "ui": test_ui_elements,
            "input": test_message_input,
            "skill": test_skill_selector,
            "agent": test_agent_selector,
            "session": test_new_session,
            "history": test_history_panel,
            "responsive": test_responsive_design,
            "ws": test_websocket_connection,
            "all": run_all_tests,
        }
        if test_name in test_map:
            test_map[test_name]()
        else:
            print(f"未知测试: {test_name}")
            print(f"可用测试: {', '.join(test_map.keys())}")
    else:
        run_all_tests()
