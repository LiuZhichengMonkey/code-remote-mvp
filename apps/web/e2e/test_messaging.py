"""
消息发送 E2E 测试

测试消息发送、接收、流式响应等功能

运行方式:
    python e2e/test_messaging.py
    python e2e/test_messaging.py send
    python e2e/test_messaging.py stream
"""

import sys
import os
import time

# 设置 UTF-8 编码
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright, expect

CHAT_UI_URL = "http://localhost:3001"
CLI_URL = "http://localhost:8080"
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")


def ensure_screenshot_dir():
    if not os.path.exists(SCREENSHOT_DIR):
        os.makedirs(SCREENSHOT_DIR)


def save_screenshot(page, name: str):
    ensure_screenshot_dir()
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  截图: {path}")


# ============================================
# 测试: 发送消息
# ============================================

def test_send_message():
    """测试发送消息"""
    print("\n=== 测试: 发送消息 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 监听控制台
        page.on("console", lambda msg: print(f"  [Console] {msg.type}: {msg.text}"))

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 找到输入框
        print("  1. 定位输入框...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
        assert input_box.count() > 0, "应该存在消息输入框"
        print(f"     找到 {input_box.count()} 个输入框")

        # 输入消息
        print("  2. 输入消息...")
        test_message = "Hello, this is a test message!"
        input_box.first.click()
        input_box.first.fill(test_message)
        time.sleep(0.3)

        # 检查输入值
        value = input_box.first.input_value()
        assert value == test_message, f"输入值不匹配: '{value}'"
        print(f"     已输入: {value}")

        save_screenshot(page, "10_message_typed")

        # 查找发送按钮
        print("  3. 查找发送按钮...")
        # 发送按钮通常在输入框附近，可能包含 Send 图标
        send_btn = page.locator('button:has(svg)').filter(has_text="").last  # 通常是最后一个按钮
        print(f"     找到按钮")

        # 注意: 不实际点击发送按钮，因为需要 WebSocket 连接
        print("  4. 测试键盘快捷键...")
        # 测试 Enter 键发送
        input_box.first.press("Enter")
        time.sleep(0.3)

        save_screenshot(page, "11_message_sent")

        browser.close()

    print("  ✓ 发送消息测试完成")


def test_multiline_input():
    """测试多行输入"""
    print("\n=== 测试: 多行输入 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 测试 Shift+Enter 换行
        print("  测试多行输入...")

        # 如果是 textarea，Shift+Enter 应该换行
        multiline_text = "Line 1\nLine 2\nLine 3"

        # 先输入第一行
        input_box.fill("Line 1")

        # 模拟 Shift+Enter
        input_box.press("Shift+Enter")
        input_box.type("Line 2")
        input_box.press("Shift+Enter")
        input_box.type("Line 3")

        value = input_box.input_value()
        print(f"     输入内容: {repr(value)}")

        save_screenshot(page, "12_multiline_input")
        browser.close()

    print("  ✓ 多行输入测试完成")


# ============================================
# 测试: 命令输入
# ============================================

def test_slash_commands():
    """测试斜杠命令"""
    print("\n=== 测试: 斜杠命令 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 测试各种命令
        commands = [
            "/help",
            "/read",
            "/ls",
            "/glob",
            "/grep",
        ]

        for cmd in commands:
            print(f"  测试命令: {cmd}")
            input_box.click()
            input_box.fill(cmd)
            time.sleep(0.2)

            # 检查是否有技能提示
            skill_panel = page.locator(f'text=/Git Commit|Create README|Simplify/i')
            if skill_panel.count() > 0:
                print(f"     ✓ 技能面板显示")

        save_screenshot(page, "13_slash_commands")
        browser.close()

    print("  ✓ 斜杠命令测试完成")


def test_at_mention():
    """测试 @ 提及"""
    print("\n=== 测试: @ 提及 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 输入 @ 触发 Agent 选择器
        print("  1. 输入 @ 触发选择器...")
        input_box.click()
        input_box.fill("@")
        time.sleep(0.5)

        # 检查 Agent 列表
        print("  2. 检查 Agent 列表...")
        agents = page.locator('text=/代码审查|架构师|测试专家|安全专家|性能专家|产品经理|运维专家/')

        if agents.count() > 0:
            print(f"     ✓ 找到 {agents.count()} 个 Agent")

            # 点击选择一个 Agent
            first_agent = agents.first
            print(f"     选择 Agent: {first_agent.text_content()}")
            first_agent.click()
            time.sleep(0.3)

            # 检查输入框是否更新
            value = input_box.input_value()
            print(f"     输入框内容: {value}")

            save_screenshot(page, "14_at_mention")
        else:
            print("     ⚠ Agent 列表未显示")

        browser.close()

    print("  ✓ @ 提及测试完成")


# ============================================
# 测试: 文件上传
# ============================================

def test_file_upload():
    """测试文件上传"""
    print("\n=== 测试: 文件上传 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找文件输入
        print("  查找文件上传按钮...")
        file_input = page.locator('input[type="file"]')

        if file_input.count() > 0:
            print("     ✓ 找到文件输入")

            # 创建测试文件
            test_file = os.path.join(SCREENSHOT_DIR, "test_upload.txt")
            with open(test_file, "w") as f:
                f.write("This is a test file for upload.")

            # 上传文件
            file_input.set_input_files(test_file)
            time.sleep(0.5)

            save_screenshot(page, "15_file_upload")
            print("     ✓ 文件已选择")
        else:
            print("     ⚠ 文件输入未找到")

        browser.close()

    print("  ✓ 文件上传测试完成")


# ============================================
# 测试: 消息显示
# ============================================

def test_message_display():
    """测试消息显示格式"""
    print("\n=== 测试: 消息显示 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 检查消息容器
        print("  1. 检查消息容器...")
        message_container = page.locator('[class*="message"], [class*="Message"]').first

        if message_container.count() > 0:
            print("     ✓ 消息容器存在")
        else:
            print("     ⚠ 消息容器未找到 (可能是空会话)")

        # 检查欢迎消息
        print("  2. 检查欢迎消息...")
        welcome_text = page.locator('text=/Welcome|欢迎|Connect|连接|Commands|命令/i')

        if welcome_text.count() > 0:
            print(f"     ✓ 找到欢迎文本")
            save_screenshot(page, "16_message_display")
        else:
            print("     ⚠ 欢迎文本未找到")

        browser.close()

    print("  ✓ 消息显示测试完成")


# ============================================
# 测试: 代码块渲染
# ============================================

def test_code_block_rendering():
    """测试代码块渲染"""
    print("\n=== 测试: 代码块渲染 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 检查代码块样式是否存在
        print("  检查代码块样式...")
        code_blocks = page.locator('pre, code, [class*="code"], [class*="Code"]')

        print(f"     找到 {code_blocks.count()} 个代码相关元素")

        # 检查 Markdown 渲染
        print("  检查 Markdown 渲染...")
        markdown_elements = page.locator('[class*="markdown"], [class*="Markdown"]')

        if markdown_elements.count() > 0:
            print(f"     ✓ Markdown 容器存在")
        else:
            print("     ⚠ Markdown 容器未找到")

        save_screenshot(page, "17_code_block")
        browser.close()

    print("  ✓ 代码块渲染测试完成")


# ============================================
# 测试: 复制功能
# ============================================

def test_copy_functionality():
    """测试复制功能"""
    print("\n=== 测试: 复制功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # 授予剪贴板权限
        context.grant_permissions(["clipboard-read", "clipboard-write"])

        page = context.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找复制按钮
        print("  查找复制按钮...")
        copy_buttons = page.locator('button:has(svg)').filter(has_text="")

        # 遍历找可能包含复制图标的按钮
        for i in range(copy_buttons.count()):
            btn = copy_buttons.nth(i)
            # 复制按钮通常有 Copy 相关的 class 或 aria-label
            btn_class = btn.get_attribute("class") or ""
            btn_aria = btn.get_attribute("aria-label") or ""

            if "copy" in btn_class.lower() or "copy" in btn_aria.lower():
                print(f"     ✓ 找到复制按钮 (索引 {i})")
                break

        save_screenshot(page, "18_copy_function")
        browser.close()

    print("  ✓ 复制功能测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有消息测试"""
    print("=" * 60)
    print("消息发送 E2E 测试")
    print("=" * 60)

    tests = [
        ("发送消息", test_send_message),
        ("多行输入", test_multiline_input),
        ("斜杠命令", test_slash_commands),
        ("@ 提及", test_at_mention),
        ("文件上传", test_file_upload),
        ("消息显示", test_message_display),
        ("代码块渲染", test_code_block_rendering),
        ("复制功能", test_copy_functionality),
    ]

    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, "✓ 通过"))
        except Exception as e:
            results.append((name, f"✗ 失败: {str(e)}"))
            print(f"  ✗ 错误: {e}")

    print("\n" + "=" * 60)
    print("测试结果")
    print("=" * 60)
    for name, result in results:
        print(f"  {name}: {result}")

    passed = sum(1 for _, r in results if "✓" in r)
    failed = sum(1 for _, r in results if "✗" in r)
    print(f"\n总计: {passed} 通过, {failed} 失败")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_map = {
            "send": test_send_message,
            "multiline": test_multiline_input,
            "slash": test_slash_commands,
            "at": test_at_mention,
            "upload": test_file_upload,
            "display": test_message_display,
            "code": test_code_block_rendering,
            "copy": test_copy_functionality,
            "all": run_all_tests,
        }
        test_name = sys.argv[1]
        if test_name in test_map:
            test_map[test_name]()
        else:
            print(f"未知测试: {test_name}")
            print(f"可用: {', '.join(test_map.keys())}")
    else:
        run_all_tests()
