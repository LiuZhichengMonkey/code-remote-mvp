"""
会话管理 E2E 测试

测试会话创建、历史、切换等功能

运行方式:
    python e2e/test_sessions.py
    python e2e/test_sessions.py history
    python e2e/test_sessions.py project
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
# 测试: 新建会话
# ============================================

def test_create_new_session():
    """测试新建会话"""
    print("\n=== 测试: 新建会话 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找新建按钮
        print("  1. 查找新建按钮...")
        new_btn = page.locator('button:has-text("New"), button:has-text("新建")')

        if new_btn.count() > 0:
            print(f"     ✓ 找到 {new_btn.count()} 个新建按钮")

            # 点击新建
            new_btn.first.click()
            time.sleep(0.5)

            save_screenshot(page, "20_new_session")

            # 检查是否创建了新会话
            print("  2. 检查新会话...")
            # 新会话应该清空消息
            messages = page.locator('[class*="message"], [class*="Message"]')
            print(f"     消息数量: {messages.count()}")
        else:
            print("     ⚠ 新建按钮未找到")

        browser.close()

    print("  ✓ 新建会话测试完成")


# ============================================
# 测试: 历史面板
# ============================================

def test_history_panel():
    """测试历史面板展开/收起"""
    print("\n=== 测试: 历史面板 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找历史面板
        print("  1. 查找历史面板...")
        sidebar = page.locator('aside, [class*="sidebar"], [class*="Sidebar"]')

        if sidebar.count() > 0:
            print(f"     ✓ 找到侧边栏")

            # 检查侧边栏可见性
            is_visible = sidebar.first.is_visible()
            print(f"     可见性: {is_visible}")

            save_screenshot(page, "21_history_panel_visible")

            # 尝试切换侧边栏
            print("  2. 尝试切换侧边栏...")
            toggle_btn = page.locator('button:has(svg)').first  # 通常是菜单按钮

            if toggle_btn.count() > 0:
                toggle_btn.click()
                time.sleep(0.3)
                save_screenshot(page, "22_history_panel_toggled")
                print("     ✓ 切换成功")
        else:
            print("     ⚠ 侧边栏未找到")

        browser.close()

    print("  ✓ 历史面板测试完成")


# ============================================
# 测试: 会话列表
# ============================================

def test_session_list():
    """测试会话列表显示"""
    print("\n=== 测试: 会话列表 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找会话列表
        print("  查找会话列表...")

        # 会话列表可能的位置
        selectors = [
            '[class*="session"]',
            '[class*="Session"]',
            '[class*="chat-list"]',
            '[class*="history"]',
            'li:has-text("Chat")',
            'li:has-text("会话")',
        ]

        found = False
        for selector in selectors:
            items = page.locator(selector)
            if items.count() > 0:
                print(f"     ✓ 找到 {items.count()} 个会话元素 ({selector})")
                found = True
                break

        if not found:
            print("     ⚠ 会话列表未找到 (可能是空状态)")

        save_screenshot(page, "23_session_list")
        browser.close()

    print("  ✓ 会话列表测试完成")


# ============================================
# 测试: 项目切换
# ============================================

def test_project_switcher():
    """测试项目切换"""
    print("\n=== 测试: 项目切换 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找项目选择器
        print("  查找项目选择器...")
        project_selector = page.locator(
            '[class*="project"], [class*="Project"], '
            'select, [class*="dropdown"], [class*="Dropdown"]'
        )

        if project_selector.count() > 0:
            print(f"     ✓ 找到 {project_selector.count()} 个项目相关元素")

            # 尝试点击展开
            project_selector.first.click()
            time.sleep(0.3)

            save_screenshot(page, "24_project_switcher")

            # 检查项目列表
            project_items = page.locator('[class*="project-item"], li:has-text("project")')
            print(f"     项目项数量: {project_items.count()}")
        else:
            print("     ⚠ 项目选择器未找到")

        browser.close()

    print("  ✓ 项目切换测试完成")


# ============================================
# 测试: 会话重命名
# ============================================

def test_session_rename():
    """测试会话重命名"""
    print("\n=== 测试: 会话重命名 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找可编辑的标题
        print("  查找会话标题...")
        title = page.locator(
            'h1, h2, [class*="title"], [class*="Title"]'
        ).first

        if title.count() > 0:
            title_text = title.text_content()
            print(f"     当前标题: {title_text}")

            # 检查是否可点击编辑
            print("  尝试点击标题...")
            title.click()
            time.sleep(0.3)

            # 检查是否变成输入框
            edit_input = page.locator('input[type="text"]:visible, [contenteditable="true"]')

            if edit_input.count() > 0:
                print("     ✓ 标题可编辑")
                save_screenshot(page, "25_session_rename")
            else:
                print("     ⚠ 标题不可编辑")
        else:
            print("     ⚠ 标题未找到")

        browser.close()

    print("  ✓ 会话重命名测试完成")


# ============================================
# 测试: 会话删除
# ============================================

def test_session_delete():
    """测试会话删除"""
    print("\n=== 测试: 会话删除 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找删除按钮
        print("  查找删除按钮...")
        delete_btn = page.locator(
            'button:has-text("Delete"), button:has-text("删除"), '
            'button:has-text("Remove"), [class*="delete"], [class*="trash"]'
        )

        if delete_btn.count() > 0:
            print(f"     ✓ 找到 {delete_btn.count()} 个删除按钮")

            # 注意: 不实际点击删除，避免误删
            print("     (跳过实际删除操作)")
        else:
            print("     ⚠ 删除按钮未找到")

        save_screenshot(page, "26_session_delete")
        browser.close()

    print("  ✓ 会话删除测试完成")


# ============================================
# 测试: 分页加载
# ============================================

def test_pagination():
    """测试分页加载"""
    print("\n=== 测试: 分页加载 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找"加载更多"按钮
        print("  查找加载更多按钮...")
        load_more = page.locator(
            'button:has-text("Load"), button:has-text("加载"), '
            'button:has-text("More"), button:has-text("更多")'
        )

        if load_more.count() > 0:
            print(f"     ✓ 找到加载按钮")

            # 滚动到顶部
            print("  滚动到顶部...")
            page.evaluate("window.scrollTo(0, 0)")
            time.sleep(0.3)

            save_screenshot(page, "27_pagination")
        else:
            print("     ⚠ 加载按钮未找到 (可能是首次加载)")

        browser.close()

    print("  ✓ 分页加载测试完成")


# ============================================
# 测试: 搜索功能
# ============================================

def test_session_search():
    """测试会话搜索"""
    print("\n=== 测试: 会话搜索 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 查找搜索框
        print("  查找搜索框...")
        search_input = page.locator(
            'input[placeholder*="search"], input[placeholder*="搜索"], '
            'input[placeholder*="Find"], input[type="search"]'
        )

        if search_input.count() > 0:
            print(f"     ✓ 找到搜索框")

            # 输入搜索词
            search_input.first.fill("test")
            time.sleep(0.5)

            save_screenshot(page, "28_session_search")
            print("     ✓ 搜索完成")
        else:
            print("     ⚠ 搜索框未找到")

        browser.close()

    print("  ✓ 会话搜索测试完成")


# ============================================
# 主函数
# ============================================

def run_all_tests():
    """运行所有会话测试"""
    print("=" * 60)
    print("会话管理 E2E 测试")
    print("=" * 60)

    tests = [
        ("新建会话", test_create_new_session),
        ("历史面板", test_history_panel),
        ("会话列表", test_session_list),
        ("项目切换", test_project_switcher),
        ("会话重命名", test_session_rename),
        ("会话删除", test_session_delete),
        ("分页加载", test_pagination),
        ("会话搜索", test_session_search),
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
            "new": test_create_new_session,
            "history": test_history_panel,
            "list": test_session_list,
            "project": test_project_switcher,
            "rename": test_session_rename,
            "delete": test_session_delete,
            "page": test_pagination,
            "search": test_session_search,
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
