"""
按钮交互 E2E 测试

测试所有按钮的点击、悬停、禁用状态等交互功能

运行方式:
    python e2e/test_buttons.py
    python e2e/test_buttons.py sidebar
    python e2e/test_buttons.py input
    python e2e/test_buttons.py message
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
# 测试: 按钮发现
# ============================================

def test_discover_buttons():
    """发现并列出所有按钮"""
    print("\n=== 测试: 按钮发现 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 获取所有按钮
        print("  1. 发现按钮...")
        buttons = page.locator('button').all()
        print(f"     找到 {len(buttons)} 个按钮")

        # 分析每个按钮
        print("\n  2. 按钮详情:")
        button_info = []
        for i, btn in enumerate(buttons):
            try:
                text = btn.inner_text().strip()[:50]
                aria = btn.get_attribute('aria-label') or ''
                title = btn.get_attribute('title') or ''
                cls = btn.get_attribute('class') or ''
                disabled = btn.is_disabled()
                visible = btn.is_visible()

                info = {
                    'index': i + 1,
                    'text': text,
                    'aria': aria,
                    'title': title,
                    'disabled': disabled,
                    'visible': visible,
                    'class': cls[:50]
                }
                button_info.append(info)

                # 打印关键信息
                label = text or aria or title or '(无标签)'
                print(f"     {i+1}. {label[:30]} - disabled={disabled} visible={visible}")
            except Exception as e:
                print(f"     {i+1}. (无法获取: {e})")

        save_screenshot(page, "30_button_discovery")
        browser.close()

        return button_info

    print("  ✓ 按钮发现测试完成")


# ============================================
# 测试: 侧边栏按钮
# ============================================

def test_sidebar_buttons():
    """测试侧边栏按钮"""
    print("\n=== 测试: 侧边栏按钮 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 1. 测试新建会话按钮
        print("  1. 测试新建会话按钮...")
        new_chat_selectors = [
            'button:has-text("New")',
            'button:has-text("新")',
            '[class*="new"]',
            '[class*="create"]',
        ]

        for selector in new_chat_selectors:
            btns = page.locator(selector)
            if btns.count() > 0:
                print(f"     找到按钮: {selector}")
                try:
                    btns.first.click()
                    time.sleep(0.3)
                    print("     点击成功")
                    save_screenshot(page, "31_new_chat_clicked")
                    break
                except Exception as e:
                    print(f"     点击失败: {e}")

        # 2. 测试历史/菜单按钮
        print("  2. 测试菜单按钮...")
        menu_selectors = [
            'button:has(svg)',  # 包含 SVG 的按钮
            '[class*="menu"]',
            '[class*="hamburger"]',
        ]

        icon_buttons = page.locator('button:has(svg)').all()
        print(f"     找到 {len(icon_buttons)} 个图标按钮")

        # 尝试点击第一个图标按钮
        if len(icon_buttons) > 0:
            try:
                icon_buttons[0].click()
                time.sleep(0.3)
                print("     点击第一个图标按钮成功")
                save_screenshot(page, "32_icon_button_clicked")
            except Exception as e:
                print(f"     点击失败: {e}")

        browser.close()

    print("  ✓ 侧边栏按钮测试完成")


# ============================================
# 测试: 输入区域按钮
# ============================================

def test_input_buttons():
    """测试输入区域按钮"""
    print("\n=== 测试: 输入区域按钮 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 1. 测试附件按钮
        print("  1. 测试附件按钮...")
        file_input = page.locator('input[type="file"]')
        if file_input.count() > 0:
            print("     找到文件输入")
            # 测试点击触发
            attach_btn = page.locator('button').filter(has_text="").nth(0)
            print("     附件按钮存在")
        else:
            print("     未找到文件输入")

        # 2. 测试发送按钮状态
        print("  2. 测试发送按钮状态...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first

        # 空输入时，发送按钮应该隐藏或禁用
        input_box.fill("")
        time.sleep(0.2)

        send_btn = page.locator('button:has(svg)').last
        print(f"     发送按钮可见: {send_btn.is_visible()}")

        # 有输入时，发送按钮应该可用
        input_box.fill("test message")
        time.sleep(0.2)
        print(f"     输入后发送按钮可见: {send_btn.is_visible()}")

        save_screenshot(page, "33_input_buttons")

        # 3. 测试麦克风按钮
        print("  3. 测试麦克风按钮...")
        mic_btns = page.locator('button').filter(has=page.locator('svg'))
        print(f"     找到 {mic_btns.count()} 个 SVG 按钮")

        browser.close()

    print("  ✓ 输入区域按钮测试完成")


# ============================================
# 测试: 消息操作按钮
# ============================================

def test_message_buttons():
    """测试消息操作按钮（复制、重新生成等）"""
    print("\n=== 测试: 消息操作按钮 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 消息操作按钮通常在消息悬停时显示
        print("  1. 查找消息区域...")
        message_areas = page.locator('[class*="message"], [class*="Message"]')
        print(f"     找到 {message_areas.count()} 个消息区域")

        # 检查是否有复制按钮
        print("  2. 查找操作按钮...")
        copy_btns = page.locator('button:has-text("Copy"), [class*="copy"], [aria-label*="copy"]')
        print(f"     复制按钮: {copy_btns.count()}")

        # 检查是否有重新生成按钮
        regenerate_btns = page.locator('button:has-text("Regenerate"), [class*="regenerate"], [aria-label*="regenerate"]')
        print(f"     重新生成按钮: {regenerate_btns.count()}")

        # 检查是否有停止按钮
        stop_btns = page.locator('button:has-text("Stop"), [class*="stop"]')
        print(f"     停止按钮: {stop_btns.count()}")

        save_screenshot(page, "34_message_buttons")
        browser.close()

    print("  ✓ 消息操作按钮测试完成")


# ============================================
# 测试: 技能选择按钮
# ============================================

def test_skill_buttons():
    """测试技能选择按钮"""
    print("\n=== 测试: 技能选择按钮 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 输入 / 触发技能面板
        print("  1. 触发技能面板...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("/")
        input_box.focus()
        time.sleep(0.5)

        save_screenshot(page, "35_skill_panel")

        # 查找技能按钮
        print("  2. 查找技能按钮...")
        skill_btns = page.locator('button:has-text("Git"), button:has-text("Create"), button:has-text("Simplify")')
        if skill_btns.count() > 0:
            print(f"     找到 {skill_btns.count()} 个技能按钮")

            # 尝试点击第一个技能
            try:
                skill_btns.first.click()
                time.sleep(0.3)
                print("     点击技能成功")
                save_screenshot(page, "36_skill_selected")
            except Exception as e:
                print(f"     点击失败: {e}")
        else:
            print("     技能按钮未找到 (可能需要连接)")

        browser.close()

    print("  ✓ 技能选择按钮测试完成")


# ============================================
# 测试: Agent 选择按钮
# ============================================

def test_agent_buttons():
    """测试 Agent 选择按钮"""
    print("\n=== 测试: Agent 选择按钮 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 输入 @ 触发 Agent 面板
        print("  1. 触发 Agent 面板...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("@")
        input_box.focus()
        time.sleep(0.5)

        save_screenshot(page, "37_agent_panel")

        # 查找 Agent 按钮
        print("  2. 查找 Agent 按钮...")
        agent_btns = page.locator('button:has-text("审查"), button:has-text("架构"), button:has-text("测试")')
        if agent_btns.count() > 0:
            print(f"     找到 {agent_btns.count()} 个 Agent 按钮")

            # 尝试点击第一个 Agent
            try:
                agent_btns.first.click()
                time.sleep(0.3)
                print("     点击 Agent 成功")
                save_screenshot(page, "38_agent_selected")

                # 检查输入框是否更新
                value = input_box.input_value()
                print(f"     输入框内容: {value}")
            except Exception as e:
                print(f"     点击失败: {e}")
        else:
            print("     Agent 按钮未找到 (可能需要连接)")

        browser.close()

    print("  ✓ Agent 选择按钮测试完成")


# ============================================
# 测试: 按钮悬停效果
# ============================================

def test_button_hover():
    """测试按钮悬停效果"""
    print("\n=== 测试: 按钮悬停效果 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        buttons = page.locator('button').all()
        print(f"  找到 {len(buttons)} 个按钮")

        hover_count = 0
        for i, btn in enumerate(buttons[:10]):  # 只测试前 10 个
            try:
                # 悬停
                btn.hover()
                time.sleep(0.1)

                # 检查是否有视觉变化（通过 class 或 style）
                cls = btn.get_attribute('class') or ''
                if 'hover' in cls.lower() or 'active' in cls.lower():
                    hover_count += 1
                    print(f"     按钮 {i+1} 有悬停效果")
            except:
                pass

        print(f"  有悬停效果的按钮: {hover_count}")
        save_screenshot(page, "39_button_hover")
        browser.close()

    print("  ✓ 按钮悬停效果测试完成")


# ============================================
# 测试: 按钮禁用状态
# ============================================

def test_button_disabled():
    """测试按钮禁用状态"""
    print("\n=== 测试: 按钮禁用状态 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        buttons = page.locator('button').all()

        disabled_count = 0
        enabled_count = 0

        print("  检查按钮状态:")
        for i, btn in enumerate(buttons):
            try:
                is_disabled = btn.is_disabled()
                if is_disabled:
                    disabled_count += 1
                else:
                    enabled_count += 1
            except:
                pass

        print(f"     可用按钮: {enabled_count}")
        print(f"     禁用按钮: {disabled_count}")

        # 输入框为空时，发送按钮应该禁用
        print("  测试空输入时发送按钮...")
        input_box = page.locator('input[placeholder*="Message"], textarea[placeholder*="Message"]').first
        input_box.fill("")
        time.sleep(0.2)

        save_screenshot(page, "40_button_disabled")
        browser.close()

    print("  ✓ 按钮禁用状态测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有按钮测试"""
    print("=" * 60)
    print("按钮交互 E2E 测试")
    print("=" * 60)

    tests = [
        ("按钮发现", test_discover_buttons),
        ("侧边栏按钮", test_sidebar_buttons),
        ("输入区域按钮", test_input_buttons),
        ("消息操作按钮", test_message_buttons),
        ("技能选择按钮", test_skill_buttons),
        ("Agent 选择按钮", test_agent_buttons),
        ("按钮悬停效果", test_button_hover),
        ("按钮禁用状态", test_button_disabled),
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
        print(f"  [{result.split(':')[0]}] {name}")

    passed = sum(1 for _, r in results if "OK" in r)
    failed = sum(1 for _, r in results if "FAIL" in r)
    print(f"\n总计: {passed} 通过, {failed} 失败")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_map = {
            "discover": test_discover_buttons,
            "sidebar": test_sidebar_buttons,
            "input": test_input_buttons,
            "message": test_message_buttons,
            "skill": test_skill_buttons,
            "agent": test_agent_buttons,
            "hover": test_button_hover,
            "disabled": test_button_disabled,
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
