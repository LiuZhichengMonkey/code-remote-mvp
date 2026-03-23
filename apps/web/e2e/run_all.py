"""
CodeRemote Web UI E2E 测试运行器

运行所有 E2E 测试

运行方式:
    python e2e/run_all.py
    python e2e/run_all.py --headless=false
    python e2e/run_all.py --test=connection
"""

import sys
import os
import argparse
import time
import subprocess
from datetime import datetime

# 设置 UTF-8 编码
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

CHAT_UI_URL = "http://localhost:3001"
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
E2E_DIR = os.path.dirname(os.path.abspath(__file__))


def ensure_screenshot_dir():
    if not os.path.exists(SCREENSHOT_DIR):
        os.makedirs(SCREENSHOT_DIR)


def save_screenshot(page, name: str):
    ensure_screenshot_dir()
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    return path


# ============================================
# 测试用例集合
# ============================================

def run_all_tests(headless: bool = True):
    """运行所有测试"""
    print("=" * 70)
    print("  CodeRemote Web UI E2E 测试套件")
    print("=" * 70)
    print(f"  时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  URL: {CHAT_UI_URL}")
    print(f"  模式: {'无头' if headless else '有头'}")
    print("=" * 70)

    all_results = []

    # 测试列表
    test_files = {
        "connection": [
            ("页面加载", "load"),
            ("UI 元素", "ui"),
            ("响应式设计", "responsive"),
        ],
        "messaging": [
            ("消息输入", "send"),
            ("多行输入", "multiline"),
            ("斜杠命令", "slash"),
            ("@ 提及", "at"),
            ("文件上传", "upload"),
            ("消息显示", "display"),
        ],
        "sessions": [
            ("新建会话", "new"),
            ("历史面板", "history"),
            ("会话列表", "list"),
            ("项目切换", "project"),
        ],
        "buttons": [
            ("按钮发现", "discover"),
            ("侧边栏按钮", "sidebar"),
            ("输入区域按钮", "input"),
            ("技能选择按钮", "skill"),
            ("Agent 选择按钮", "agent"),
            ("按钮悬停效果", "hover"),
        ],
        "button_functional": [
            ("发送按钮功能", "send"),
            ("新建会话功能", "new"),
            ("技能按钮功能", "skill"),
            ("Agent 按钮功能", "agent"),
            ("文件上传功能", "upload"),
            ("停止按钮功能", "stop"),
        ],
        "complex": [
            ("WebSocket 流程", "websocket"),
            ("会话流程", "session"),
            ("消息流", "message"),
            ("多 Agent 讨论", "agent"),
            ("错误处理", "error"),
            ("响应式行为", "responsive"),
            ("会话恢复", "recovery"),
        ],
    }

    # 运行各测试组
    for group_name, tests in test_files.items():
        print(f"\n{'=' * 50}")
        print(f"  测试组: {group_name}")
        print(f"{'=' * 50}")

        for test_name, test_arg in tests:
            print(f"\n  运行: {test_name}...", end=" ")

            try:
                # 使用子进程运行测试
                test_file = f"test_{group_name}.py"
                cmd = [sys.executable, os.path.join(E2E_DIR, test_file), test_arg]

                start = time.time()
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    encoding='utf-8',
                    errors='replace'
                )
                duration = time.time() - start

                if result.returncode == 0:
                    print(f"OK ({duration:.2f}s)")
                    all_results.append({
                        "group": group_name,
                        "name": test_name,
                        "status": "OK",
                        "duration": f"{duration:.2f}s",
                        "error": None
                    })
                else:
                    error_msg = result.stderr.strip().split('\n')[-1] if result.stderr else "Unknown error"
                    print(f"FAIL: {error_msg[:50]}")
                    all_results.append({
                        "group": group_name,
                        "name": test_name,
                        "status": "FAIL",
                        "duration": f"{duration:.2f}s",
                        "error": error_msg[:100]
                    })

            except subprocess.TimeoutExpired:
                print("TIMEOUT (>60s)")
                all_results.append({
                    "group": group_name,
                    "name": test_name,
                    "status": "TIMEOUT",
                    "duration": ">60s",
                    "error": "Test timeout"
                })
            except Exception as e:
                print(f"ERROR: {str(e)[:50]}")
                all_results.append({
                    "group": group_name,
                    "name": test_name,
                    "status": "ERROR",
                    "duration": "0s",
                    "error": str(e)[:100]
                })

    # 打印结果汇总
    print("\n" + "=" * 70)
    print("  测试结果汇总")
    print("=" * 70)

    passed = 0
    failed = 0

    for result in all_results:
        status = "OK" if result["status"] == "OK" else "FAIL"
        print(f"  [{status}] [{result['group']}] {result['name']}")
        if result["error"]:
            print(f"      错误: {result['error']}")
        if result["status"] == "OK":
            passed += 1
        else:
            failed += 1

    print("\n" + "-" * 70)
    print(f"  总计: {passed} 通过, {failed} 失败")
    print(f"  截图目录: {SCREENSHOT_DIR}")
    print("=" * 70)

    return all_results


def main():
    parser = argparse.ArgumentParser(description="CodeRemote Web UI E2E 测试")
    parser.add_argument("--headless", type=str, default="true",
                       help="是否无头模式 (true/false)")
    parser.add_argument("--test", type=str, default="all",
                       help="要运行的测试组 (all/connection/messaging/sessions)")
    parser.add_argument("--url", type=str, default=CHAT_UI_URL,
                       help="Web UI URL")
    args = parser.parse_args()

    headless = args.headless.lower() != "false"

    run_all_tests(headless=headless)


if __name__ == "__main__":
    main()
