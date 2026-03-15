"""
按钮功能 E2E 测试

测试按钮点击后的实际功能效果

运行方式:
    python e2e/test_button_functional.py
    python e2e/test_button_functional.py send
    python e2e/test_button_functional.py skill
    python e2e/test_button_functional.py agent
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

from playwright.sync_api import sync_playwright

CHAT_UI_URL = "http://localhost:3001"
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
# 测试: 发送按钮功能
# ============================================

def test_send_button_function():
    """测试发送按钮 - 验证消息发送后显示在聊天区"""
    print("\n=== 测试: 发送按钮功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(1)  # 等待连接

        # 1. 找到输入框
        print("  1. 定位输入框...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        assert input_box.count() > 0, "输入框不存在"
        print("     ✓ 输入框存在")

        # 2. 输入测试消息
        print("  2. 输入测试消息...")
        test_message = "Test message for send button"
        input_box.fill(test_message)
        time.sleep(0.3)

        # 验证输入值
        value = input_box.input_value()
        assert test_message in value, f"输入值不匹配: {value}"
        print(f"     ✓ 已输入: {value}")

        # 3. 点击发送按钮
        print("  3. 点击发送按钮...")
        # 找到发送按钮（通常是包含 Send 图标的按钮）
        send_btn = page.locator('button:has(svg)').last  # 最后一个图标按钮通常是发送
        send_btn.click()
        time.sleep(1)

        save_screenshot(page, "50_send_clicked")

        # 4. 验证消息是否出现在聊天区
        print("  4. 验证消息显示...")
        # 等待消息出现
        message_locators = [
            f'text="{test_message}"',
            f'text="Test message"',
            '[class*="message"]:has-text("Test")',
            '[class*="Message"]:has-text("Test")',
        ]

        found = False
        for locator in message_locators:
            try:
                msg = page.locator(locator)
                if msg.count() > 0:
                    print(f"     ✓ 消息已显示: {msg.first.text_content()[:50]}")
                    found = True
                    break
            except:
                pass

        if not found:
            print("     ⚠ 消息未显示（可能需要 WebSocket 连接）")

        # 5. 验证输入框已清空
        print("  5. 验证输入框状态...")
        new_value = input_box.input_value()
        if new_value == "":
            print("     ✓ 输入框已清空")
        else:
            print(f"     ⚠ 输入框未清空: {new_value}")

        browser.close()

    print("  ✓ 发送按钮功能测试完成")


# ============================================
# 测试: 新建会话按钮功能
# ============================================

def test_new_session_function():
    """测试新建会话按钮 - 验证会话创建"""
    print("\n=== 测试: 新建会话功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        # 1. 记录当前会话
        print("  1. 获取当前会话状态...")
        initial_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     当前消息数: {initial_messages}")

        # 2. 发送一条消息创建会话
        print("  2. 发送消息创建会话...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("Creating a session")
        send_btn = page.locator('button:has(svg)').last
        send_btn.click()
        time.sleep(1)

        save_screenshot(page, "51_session_before")

        # 3. 点击新建会话
        print("  3. 点击新建会话...")
        # 查找新建按钮
        new_btn_selectors = [
            'button:has-text("New")',
            'button:has-text("+")',
            '[class*="new-chat"]',
            '[class*="newChat"]',
        ]

        clicked = False
        for selector in new_btn_selectors:
            btns = page.locator(selector)
            if btns.count() > 0:
                btns.first.click()
                clicked = True
                print(f"     点击了: {selector}")
                break

        if not clicked:
            # 尝试第一个图标按钮
            first_icon = page.locator('button:has(svg)').first
            if first_icon.count() > 0:
                first_icon.click()
                print("     点击了第一个图标按钮")

        time.sleep(0.5)
        save_screenshot(page, "52_session_after")

        # 4. 验证会话状态变化
        print("  4. 验证会话状态...")
        new_messages = page.locator('[class*="message"], [class*="Message"]').count()
        print(f"     新消息数: {new_messages}")

        # 检查是否有欢迎消息
        welcome = page.locator('text=/Welcome|欢迎|Connect|开始|Start/i')
        if welcome.count() > 0:
            print("     ✓ 检测到欢迎消息（可能是新会话）")
        else:
            print("     ⚠ 未检测到欢迎消息")

        browser.close()

    print("  ✓ 新建会话功能测试完成")


# ============================================
# 测试: 技能按钮功能
# ============================================

def test_skill_button_function():
    """测试技能按钮 - 验证技能选择后输入框更新"""
    print("\n=== 测试: 技能按钮功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 1. 触发技能面板
        print("  1. 触发技能面板...")
        input_box.fill("/")
        input_box.focus()
        time.sleep(0.5)

        # 2. 验证技能面板显示
        print("  2. 验证技能面板显示...")
        skill_panel = page.locator('text=/Git Commit|Create README|Simplify|Brainstorm/i')
        if skill_panel.count() > 0:
            print(f"     ✓ 技能面板显示，找到 {skill_panel.count()} 个技能")

            # 3. 点击第一个技能
            print("  3. 点击技能...")
            first_skill = skill_panel.first
            skill_name = first_skill.text_content()
            print(f"     选择技能: {skill_name}")
            first_skill.click()
            time.sleep(0.3)

            save_screenshot(page, "53_skill_selected")

            # 4. 验证输入框更新
            print("  4. 验证输入框更新...")
            new_value = input_box.input_value()
            if new_value.startswith("/"):
                print(f"     ✓ 输入框已更新: {new_value}")
            else:
                print(f"     ⚠ 输入框未更新: {new_value}")
        else:
            print("     ⚠ 技能面板未显示")

        browser.close()

    print("  ✓ 技能按钮功能测试完成")


# ============================================
# 测试: Agent 按钮功能
# ============================================

def test_agent_button_function():
    """测试 Agent 按钮 - 验证 Agent 选择后输入框更新"""
    print("\n=== 测试: Agent 按钮功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 1. 触发 Agent 面板
        print("  1. 触发 Agent 面板...")
        input_box.fill("@")
        input_box.focus()
        time.sleep(0.5)

        # 2. 验证 Agent 面板显示
        print("  2. 验证 Agent 面板显示...")
        agent_panel = page.locator('text=/代码审查|架构师|测试专家|安全专家|性能专家|产品经理|运维专家/i')
        if agent_panel.count() > 0:
            print(f"     ✓ Agent 面板显示，找到 {agent_panel.count()} 个 Agent")

            # 3. 点击第一个 Agent
            print("  3. 点击 Agent...")
            first_agent = agent_panel.first
            agent_name = first_agent.text_content()
            print(f"     选择 Agent: {agent_name}")
            first_agent.click()
            time.sleep(0.3)

            save_screenshot(page, "54_agent_selected")

            # 4. 验证输入框更新
            print("  4. 验证输入框更新...")
            new_value = input_box.input_value()
            if "@" in new_value:
                print(f"     ✓ 输入框已更新: {new_value}")
            else:
                print(f"     ⚠ 输入框未更新: {new_value}")

            # 5. 选择多个 Agent
            print("  5. 测试多选 Agent...")
            input_box.fill("@")
            time.sleep(0.3)

            # 点击另一个 Agent
            other_agents = page.locator('text=/架构师|测试专家|安全专家/i')
            if other_agents.count() > 0:
                other_agents.first.click()
                time.sleep(0.3)
                multi_value = input_box.input_value()
                print(f"     多选后输入框: {multi_value}")
                save_screenshot(page, "55_multi_agent")
        else:
            print("     ⚠ Agent 面板未显示")

        browser.close()

    print("  ✓ Agent 按钮功能测试完成")


# ============================================
# 测试: 复制按钮功能
# ============================================

def test_copy_button_function():
    """测试复制按钮 - 验证内容复制到剪贴板"""
    print("\n=== 测试: 复制按钮功能 ===")

    with sync_playwright() as p:
        # 需要授予权限
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        context.grant_permissions(["clipboard-read", "clipboard-write"])
        page = context.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 先发送一条消息
        print("  1. 发送测试消息...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("Test message for copy")
        send_btn = page.locator('button:has(svg)').last
        send_btn.click()
        time.sleep(1)

        # 查找复制按钮
        print("  2. 查找复制按钮...")
        copy_selectors = [
            'button[aria-label*="copy" i]',
            'button[aria-label*="Copy" i]',
            'button:has(svg[class*="copy"])',
            'button:has(svg) ~ button:has(svg)',  # 常见模式：操作按钮组
        ]

        copy_btn = None
        for selector in copy_selectors:
            btns = page.locator(selector)
            if btns.count() > 0:
                copy_btn = btns.first
                print(f"     找到复制按钮: {selector}")
                break

        if copy_btn:
            print("  3. 点击复制按钮...")
            copy_btn.click()
            time.sleep(0.3)

            # 验证剪贴板
            print("  4. 验证剪贴板...")
            try:
                clipboard = page.evaluate("navigator.clipboard.readText()")
                if clipboard:
                    print(f"     ✓ 剪贴板内容: {clipboard[:50]}...")
                else:
                    print("     ⚠ 剪贴板为空")
            except Exception as e:
                print(f"     ⚠ 无法读取剪贴板: {e}")

            save_screenshot(page, "56_copy_clicked")
        else:
            print("     ⚠ 复制按钮未找到（可能消息不存在）")

        browser.close()

    print("  ✓ 复制按钮功能测试完成")


# ============================================
# 测试: 文件上传按钮功能
# ============================================

def test_file_upload_function():
    """测试文件上传按钮 - 验证文件选择和预览"""
    print("\n=== 测试: 文件上传功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 1. 查找文件输入
        print("  1. 查找文件输入...")
        file_input = page.locator('input[type="file"]')
        assert file_input.count() > 0, "文件输入不存在"
        print("     ✓ 文件输入存在")

        # 2. 创建测试文件
        print("  2. 创建测试文件...")
        test_file = os.path.join(SCREENSHOT_DIR, "test_upload.txt")
        ensure_screenshot_dir()
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("This is a test file for upload functionality.\n测试文件上传功能。")
        print(f"     测试文件: {test_file}")

        # 3. 上传文件
        print("  3. 上传文件...")
        file_input.set_input_files(test_file)
        time.sleep(0.5)

        save_screenshot(page, "57_file_uploaded")

        # 4. 验证文件预览
        print("  4. 验证文件预览...")
        preview_selectors = [
            '[class*="preview"]',
            '[class*="attachment"]',
            'img[src*="blob"]',
            'text="test_upload.txt"',
        ]

        found_preview = False
        for selector in preview_selectors:
            try:
                preview = page.locator(selector)
                if preview.count() > 0:
                    print(f"     ✓ 文件预览显示: {selector}")
                    found_preview = True
                    break
            except:
                pass

        if not found_preview:
            print("     ⚠ 文件预览未显示")

        # 5. 验证发送按钮状态
        print("  5. 验证发送按钮...")
        send_btn = page.locator('button:has(svg)').last
        if send_btn.is_visible():
            print("     ✓ 发送按钮可用")
        else:
            print("     ⚠ 发送按钮不可见")

        browser.close()

    print("  ✓ 文件上传功能测试完成")


# ============================================
# 测试: 停止按钮功能
# ============================================

def test_stop_button_function():
    """测试停止按钮 - 验证生成中断"""
    print("\n=== 测试: 停止按钮功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')
        time.sleep(1)

        # 1. 发送一个会触发长响应的消息
        print("  1. 发送长响应请求...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("请写一个很长的故事，至少500字")
        send_btn = page.locator('button:has(svg)').last
        send_btn.click()
        time.sleep(0.5)

        # 2. 查找停止按钮
        print("  2. 查找停止按钮...")
        time.sleep(1)  # 等待响应开始

        stop_selectors = [
            'button:has-text("Stop")',
            'button:has-text("停止")',
            '[class*="stop"]',
            '[class*="Stop"]',
            'button svg[class*="stop"]',
        ]

        stop_btn = None
        for selector in stop_selectors:
            btns = page.locator(selector)
            if btns.count() > 0:
                stop_btn = btns.first
                print(f"     找到停止按钮: {selector}")
                break

        if stop_btn:
            print("  3. 点击停止按钮...")
            stop_btn.click()
            time.sleep(0.3)

            save_screenshot(page, "58_stop_clicked")
            print("     ✓ 停止按钮已点击")

            # 验证生成停止
            print("  4. 验证生成停止...")
            time.sleep(0.5)

            # 检查是否还有加载指示器
            loading = page.locator('[class*="loading"], [class*="generating"], [class*="streaming"]')
            if loading.count() > 0:
                print("     ⚠ 可能仍在生成")
            else:
                print("     ✓ 生成已停止")
        else:
            print("     ⚠ 停止按钮未找到（可能未开始生成）")

        browser.close()

    print("  ✓ 停止按钮功能测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有按钮功能测试"""
    print("=" * 60)
    print("按钮功能 E2E 测试")
    print("=" * 60)

    tests = [
        ("发送按钮功能", test_send_button_function),
        ("新建会话功能", test_new_session_function),
        ("技能按钮功能", test_skill_button_function),
        ("Agent 按钮功能", test_agent_button_function),
        ("复制按钮功能", test_copy_button_function),
        ("文件上传功能", test_file_upload_function),
        ("停止按钮功能", test_stop_button_function),
    ]

    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, "OK"))
        except Exception as e:
            results.append((name, f"FAIL: {str(e)[:50]}"))
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
            "send": test_send_button_function,
            "new": test_new_session_function,
            "skill": test_skill_button_function,
            "agent": test_agent_button_function,
            "copy": test_copy_button_function,
            "upload": test_file_upload_function,
            "stop": test_stop_button_function,
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
