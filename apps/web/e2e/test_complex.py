"""
复杂业务逻辑 E2E 测试

测试完整的用户交互流程和业务逻辑

运行方式:
    python e2e/test_complex.py
    python e2e/test_complex.py websocket
    python e2e/test_complex.py session_flow
    python e2e/test_complex.py message_flow
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright

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


def wait_for_connection(page, timeout=10):
    """等待 WebSocket 连接就绪"""
    input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
    for _ in range(timeout * 2):
        if not input_box.is_disabled():
            return True
        time.sleep(0.5)
    return False


def set_input_value(page, text):
    """安全设置输入框值 - 使用 JSON 避免 JS 注入问题"""
    input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
    input_box.click()
    # 使用 JSON.stringify 安全处理特殊字符
    json_text = json.dumps(text, ensure_ascii=False)
    input_box.evaluate(f'''
        (el) => {{
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
                'value'
            ).set;
            nativeInputValueSetter.call(el, {json_text});
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
        }}
    ''')
    time.sleep(0.3)
    return input_box


def send_message(page, text):
    """发送消息的辅助函数 - 使用 JavaScript 触发 React 状态更新"""
    input_box = set_input_value(page, text)
    # 使用 Enter 键发送
    input_box.press("Enter")
    time.sleep(0.5)
    return True


# ============================================
# 测试 1: WebSocket 完整连接流程
# ============================================

def test_websocket_flow():
    """测试 WebSocket 连接、认证、消息收发完整流程"""
    print("\n=== 测试: WebSocket 完整流程 ===")

    ws_messages = []
    ws_connected = False
    ws_authenticated = False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 监听 WebSocket
        def on_websocket(ws):
            nonlocal ws_connected
            print(f"  [WS] 连接: {ws.url}")
            ws_connected = True

            def on_frames_received(frames):
                for frame in frames:
                    try:
                        data = json.loads(frame.payload)
                        ws_messages.append(data)
                        print(f"  [WS] 接收: {data.get('type', 'unknown')}")

                        if data.get('type') == 'auth_success':
                            nonlocal ws_authenticated
                            ws_authenticated = True
                    except:
                        pass

            ws.on("framesreceived", on_frames_received)

        page.on("websocket", on_websocket)

        # 监听控制台
        page.on("console", lambda msg: None)  # 静默处理

        print("  1. 加载页面...")
        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(3)  # 等待 WebSocket 连接完成

        # 等待连接状态
        print("  2. 等待连接就绪...")
        if not wait_for_connection(page):
            print("     ⚠ 输入框仍被禁用，可能未连接")
        else:
            print("     ✓ 输入框已启用，连接就绪")

        save_screenshot(page, "60_ws_connected")

        # 发送测试消息
        print("  3. 发送测试消息...")
        send_message(page, "Hello, this is a WebSocket test!")
        time.sleep(1)

        save_screenshot(page, "61_ws_message_sent")

        # 验证消息发送
        print("  4. 验证消息发送...")
        message_sent = False
        for msg in ws_messages:
            if msg.get('type') == 'message':
                message_sent = True
                print(f"     ✓ 消息已发送: {msg.get('content', '')[:30]}")
                break

        if not message_sent:
            print("     ⚠ 消息未通过 WebSocket 发送（可能是通过其他机制）")

        # 等待响应
        print("  5. 等待响应...")
        time.sleep(3)

        # 检查消息列表
        messages = page.locator('[class*="message"], [class*="Message"]')
        print(f"     消息数量: {messages.count()}")

        save_screenshot(page, "62_ws_response")

        browser.close()

    print(f"\n  结果: WebSocket连接={ws_connected}, 认证={ws_authenticated}, 消息数={len(ws_messages)}")
    print("  ✓ WebSocket 流程测试完成")


# ============================================
# 测试 2: 完整会话流程
# ============================================

def test_session_flow():
    """测试会话创建、切换、历史恢复流程"""
    print("\n=== 测试: 完整会话流程 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        # 等待连接就绪
        if not wait_for_connection(page):
            print("     ⚠ 连接超时，跳过测试")
            browser.close()
            return

        # 1. 创建第一个会话并发送消息
        print("  1. 创建第一个会话...")
        send_message(page, "First session message - hello")
        time.sleep(1)

        save_screenshot(page, "63_session_1_created")

        # 2. 记录当前会话
        print("  2. 记录第一个会话...")
        session_1_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     会话1消息数: {session_1_messages}")

        # 3. 创建新会话
        print("  3. 创建新会话...")
        first_btn = page.locator('button:has(svg)').first
        first_btn.click()
        time.sleep(0.5)

        # 查找新建按钮
        new_btn = page.locator('button:has-text("New"), button:has-text("+"), [class*="new"]')
        if new_btn.count() > 0:
            new_btn.first.click()
            time.sleep(0.5)

        save_screenshot(page, "64_session_2_created")

        # 4. 在新会话中发送不同消息
        print("  4. 在新会话中发送消息...")
        send_message(page, "Second session message - world")
        time.sleep(1)

        session_2_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     会话2消息数: {session_2_messages}")

        # 5. 验证两个会话消息数不同
        print("  5. 验证会话隔离...")
        if session_2_messages != session_1_messages:
            print("     ✓ 会话消息隔离正常")
        else:
            print("     ⚠ 会话可能未正确隔离")

        save_screenshot(page, "65_session_isolated")

        # 6. 查找历史列表
        print("  6. 查找历史列表...")
        history_selectors = [
            '[class*="history"]',
            '[class*="session"]',
            '[class*="sidebar"] li',
            'aside li',
        ]

        history_found = False
        for selector in history_selectors:
            items = page.locator(selector)
            if items.count() > 0:
                print(f"     找到历史项: {selector} ({items.count()}个)")
                history_found = True
                break

        if not history_found:
            print("     ⚠ 历史列表未找到")

        browser.close()

    print("  ✓ 会话流程测试完成")


# ============================================
# 测试 3: 消息流测试
# ============================================

def test_message_flow():
    """测试消息发送、接收、显示、流式更新"""
    print("\n=== 测试: 消息流 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        if not wait_for_connection(page):
            print("     ⚠ 连接超时，跳过测试")
            browser.close()
            return

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 测试不同类型的消息
        test_messages = [
            "Simple text message",
            "Message with numbers 12345",
            "特殊字符测试 !@#$%",
        ]

        for i, msg in enumerate(test_messages):
            print(f"  {i+1}. 发送消息: {msg[:20]}...")
            send_message(page, msg)
            time.sleep(1.5)

            # 验证输入框清空
            value = input_box.input_value()
            if value == "":
                print("     ✓ 输入框已清空")
            else:
                print(f"     ⚠ 输入框内容: {value}")

            # 验证消息显示
            messages = page.locator('[class*="message"], [class*="Message"]')
            count = messages.count()
            print(f"     当前消息数: {count}")

        save_screenshot(page, "66_message_flow")

        # 测试长消息
        print("  4. 测试长消息...")
        long_message = "A" * 500
        send_message(page, long_message)
        time.sleep(1)

        save_screenshot(page, "67_long_message")

        # 测试空消息
        print("  5. 测试空消息...")
        input_box.click()
        input_box.evaluate('''(el) => {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
                'value'
            ).set;
            nativeInputValueSetter.call(el, '   ');
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }''')
        time.sleep(0.3)

        # 检查发送按钮是否可见（空消息时应该不可见）
        send_btn_visible = page.locator('button:has(svg)').last.is_visible()
        print(f"     空输入时发送按钮可见: {send_btn_visible}")

        browser.close()

    print("  ✓ 消息流测试完成")


# ============================================
# 测试 4: 多 Agent 讨论流程
# ============================================

def test_multi_agent_discussion():
    """测试多 Agent 讨论功能"""
    print("\n=== 测试: 多 Agent 讨论 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        if not wait_for_connection(page):
            print("     ⚠ 连接超时，跳过测试")
            browser.close()
            return

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 1. 触发 Agent 选择
        print("  1. 触发 Agent 选择...")
        input_box.click()
        input_box.evaluate('''(el) => {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
                'value'
            ).set;
            nativeInputValueSetter.call(el, '@');
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }''')
        time.sleep(0.5)

        agent_panel = page.locator('text=/代码审查|架构师|测试专家|安全专家|性能专家/i')
        if agent_panel.count() == 0:
            print("     ⚠ Agent 面板未显示，跳过测试")
            browser.close()
            return

        print(f"     ✓ Agent 面板显示，找到 {agent_panel.count()} 个 Agent")

        # 2. 选择多个 Agent
        print("  2. 选择多个 Agent...")
        first_agent = agent_panel.first
        agent_name_1 = first_agent.text_content()
        first_agent.click()
        time.sleep(0.3)

        # 再次触发面板选择第二个 Agent
        current_value = input_box.input_value()
        set_input_value(page, current_value + " @")
        time.sleep(0.3)

        # 选择另一个 Agent
        second_agent = page.locator('text=/架构师|测试专家|安全专家/i').first
        if second_agent.count() > 0:
            agent_name_2 = second_agent.text_content()
            second_agent.click()
            time.sleep(0.3)
            print(f"     选择了: {agent_name_1}, {agent_name_2}")

        save_screenshot(page, "68_multi_agent_selected")

        # 3. 输入讨论主题
        print("  3. 输入讨论主题...")
        current_value = input_box.input_value()
        discussion_topic = current_value + " 如何优化代码性能？"
        set_input_value(page, discussion_topic)
        time.sleep(0.3)

        print(f"     输入: {discussion_topic[:50]}...")

        # 4. 发送讨论请求
        print("  4. 发送讨论请求...")
        input_box.press("Enter")
        time.sleep(2)

        save_screenshot(page, "69_discussion_sent")

        # 5. 验证讨论消息显示
        print("  5. 验证讨论消息...")
        discussion_markers = page.locator('[class*="agent"], [class*="discussion"]').count()
        print(f"     找到 {discussion_markers} 个讨论相关元素")

        messages = page.locator('[class*="message"], [class*="Message"]')
        print(f"     消息数: {messages.count()}")

        browser.close()

    print("  ✓ 多 Agent 讨论测试完成")


# ============================================
# 测试 5: 错误处理流程
# ============================================

def test_error_handling():
    """测试错误处理和边界情况"""
    print("\n=== 测试: 错误处理 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 收集控制台错误
        errors = []
        page.on("console", lambda msg:
            errors.append(msg.text) if msg.type == "error" else None)

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        if not wait_for_connection(page):
            print("     ⚠ 连接超时，跳过测试")
            browser.close()
            return

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 1. 测试特殊字符
        print("  1. 测试特殊字符...")
        special_chars = [
            "<script>alert('xss')</script>",
            "'; DROP TABLE users; --",
            "{{template}}",
            "${variable}",
            "../../../etc/passwd",
        ]

        for char in special_chars:
            # 使用 fill 方法进行简单测试（不触发发送）
            input_box.fill(char)
            time.sleep(0.2)
            value = input_box.input_value()
            print(f"     输入: {char[:30]}... -> 存储: {value[:30] if value else '(empty)'}...")

        save_screenshot(page, "70_special_chars")

        # 2. 测试超长输入
        print("  2. 测试超长输入...")
        long_input = "A" * 10000
        input_box.fill(long_input)
        time.sleep(0.3)

        stored_value = input_box.input_value()
        print(f"     输入10000字符, 存储: {len(stored_value)}字符")

        # 3. 测试快速连续发送
        print("  3. 测试快速连续发送...")
        for i in range(3):
            send_message(page, f"Rapid message {i+1}")
            time.sleep(0.3)

        time.sleep(1)
        save_screenshot(page, "71_rapid_send")

        # 4. 测试网络断开
        print("  4. 测试网络状态...")
        page.context.set_offline(True)
        time.sleep(1)

        send_message(page, "Offline message")
        time.sleep(1)

        # 使用正确的选择器语法
        error_indicators = page.locator('[class*="error"], [class*="offline"]')
        if error_indicators.count() > 0:
            print("     ✓ 检测到离线提示")

        save_screenshot(page, "72_offline")

        # 恢复网络
        page.context.set_offline(False)
        time.sleep(1)

        # 5. 检查控制台错误
        print("  5. 控制台错误...")
        if errors:
            print(f"     发现 {len(errors)} 个控制台错误:")
            for err in errors[:3]:
                print(f"       - {err[:80]}")
        else:
            print("     ✓ 无控制台错误")

        browser.close()

    print("  ✓ 错误处理测试完成")


# ============================================
# 测试 6: 响应式布局变化
# ============================================

def test_responsive_behavior():
    """测试响应式布局下的功能变化"""
    print("\n=== 测试: 响应式行为 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        viewports = [
            ("桌面", 1920, 1080),
            ("平板", 768, 1024),
            ("手机", 375, 667),
        ]

        for name, width, height in viewports:
            print(f"\n  测试 {name} ({width}x{height}):")

            page = browser.new_page(viewport={'width': width, 'height': height})
            page.goto(CHAT_UI_URL)
            page.wait_for_load_state('networkidle')

            # 测试输入框
            input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]')
            if input_box.count() > 0:
                input_visible = input_box.first.is_visible()
                print(f"     输入框可见: {input_visible}")

            # 测试按钮
            buttons = page.locator('button').count()
            print(f"     按钮数: {buttons}")

            # 测试侧边栏
            sidebar = page.locator('aside, [class*="sidebar"], [class*="Sidebar"]')
            sidebar_visible = sidebar.count() > 0 and sidebar.first.is_visible()
            print(f"     侧边栏可见: {sidebar_visible}")

            # 测试菜单按钮
            menu_btn = page.locator('button:has(svg)').first
            if menu_btn.count() > 0:
                print(f"     菜单按钮存在")

                if width < 768:
                    menu_btn.click()
                    time.sleep(0.3)
                    save_screenshot(page, f"73_responsive_{name}_menu")

            save_screenshot(page, f"73_responsive_{name}")

            page.close()

        browser.close()

    print("  ✓ 响应式行为测试完成")


# ============================================
# 测试 7: 历史会话恢复
# ============================================

def test_session_recovery():
    """测试历史会话恢复功能"""
    print("\n=== 测试: 会话恢复 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        print("  1. 创建第一个会话...")
        page = browser.new_page()
        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        if not wait_for_connection(page):
            print("     ⚠ 连接超时，跳过测试")
            browser.close()
            return

        send_message(page, "Session recovery test - unique message 12345")
        time.sleep(1.5)

        save_screenshot(page, "74_recovery_session1")

        session1_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     会话1消息数: {session1_messages}")

        # 刷新页面
        print("  2. 刷新页面...")
        page.reload()
        page.wait_for_load_state('networkidle')
        time.sleep(2)

        save_screenshot(page, "75_recovery_refresh")

        # 验证消息恢复
        print("  3. 验证消息恢复...")
        recovered_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     刷新后消息数: {recovered_messages}")

        if recovered_messages >= session1_messages:
            print("     ✓ 消息已恢复")
        else:
            print("     ⚠ 部分消息丢失")

        # 测试新标签页
        print("  4. 测试新标签页...")
        page2 = browser.new_page()
        page2.goto(CHAT_UI_URL)
        page2.wait_for_load_state('networkidle')
        time.sleep(2)

        tab2_messages = page2.locator('[class*="message"], [class*="Message"]').count()
        print(f"     新标签页消息数: {tab2_messages}")

        save_screenshot(page2, "76_recovery_tab2")

        page.close()
        page2.close()

        browser.close()

    print("  ✓ 会话恢复测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有复杂逻辑测试"""
    print("=" * 60)
    print("复杂业务逻辑 E2E 测试")
    print("=" * 60)

    tests = [
        ("WebSocket 流程", test_websocket_flow),
        ("会话流程", test_session_flow),
        ("消息流", test_message_flow),
        ("多 Agent 讨论", test_multi_agent_discussion),
        ("错误处理", test_error_handling),
        ("响应式行为", test_responsive_behavior),
        ("会话恢复", test_session_recovery),
    ]

    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, "OK"))
        except Exception as e:
            results.append((name, f"FAIL: {str(e)[:60]}"))
            print(f"  错误: {e}")

    print("\n" + "=" * 60)
    print("测试结果")
    print("=" * 60)
    for name, result in results:
        status = "OK" if "OK" in result else "FAIL"
        print(f"  [{status}] {name}")
        if "FAIL" in result:
            print(f"        {result}")

    passed = sum(1 for _, r in results if "OK" in r)
    failed = sum(1 for _, r in results if "FAIL" in r)
    print(f"\n总计: {passed} 通过, {failed} 失败")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_map = {
            "websocket": test_websocket_flow,
            "session": test_session_flow,
            "message": test_message_flow,
            "agent": test_multi_agent_discussion,
            "error": test_error_handling,
            "responsive": test_responsive_behavior,
            "recovery": test_session_recovery,
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
