# Web UI E2E 测试

使用 Playwright 进行端到端测试。

## 安装依赖

```bash
# 安装 Playwright
pip install playwright

# 安装浏览器
python -m playwright install chromium
```

## 运行测试

### 运行所有测试

```bash
# 进入 apps/web/e2e 目录
cd apps/web/e2e

# 运行所有测试
python run_all.py

# 有头模式（可见浏览器）
python run_all.py --headless=false

# 运行指定测试组
python run_all.py --test=connection
python run_all.py --test=messaging
python run_all.py --test=sessions

# 指定 URL
python run_all.py --url=http://localhost:3001
```

### 运行单独测试文件

```bash
# 连接测试
python test_connection.py
python test_connection.py load       # 只运行页面加载测试
python test_connection.py ui         # 只运行 UI 元素测试
python test_connection.py responsive # 只运行响应式测试

# 消息测试
python test_messaging.py
python test_messaging.py send        # 发送消息测试
python test_messaging.py slash       # 斜杠命令测试
python test_messaging.py at          # @ 提及测试
python test_messaging.py upload      # 文件上传测试

# 会话测试
python test_sessions.py
python test_sessions.py new          # 新建会话测试
python test_sessions.py history      # 历史面板测试
python test_sessions.py project      # 项目切换测试
```

## 测试覆盖

### 连接测试 (`test_connection.py`)

| 测试 | 说明 |
|------|------|
| `test_page_load` | 页面是否正常加载 |
| `test_ui_elements` | UI 元素是否存在 |
| `test_responsive_design` | 响应式布局测试 |
| `test_websocket_connection` | WebSocket 连接测试 |

### 消息测试 (`test_messaging.py`)

| 测试 | 说明 |
|------|------|
| `test_send_message` | 发送消息功能 |
| `test_multiline_input` | 多行输入 |
| `test_slash_commands` | `/` 斜杠命令 |
| `test_at_mention` | `@` 提及 Agent |
| `test_file_upload` | 文件上传 |
| `test_message_display` | 消息显示格式 |
| `test_code_block_rendering` | 代码块渲染 |
| `test_copy_functionality` | 复制功能 |

### 会话测试 (`test_sessions.py`)

| 测试 | 说明 |
|------|------|
| `test_create_new_session` | 新建会话 |
| `test_history_panel` | 历史面板 |
| `test_session_list` | 会话列表显示 |
| `test_project_switcher` | 项目切换 |
| `test_session_rename` | 会话重命名 |
| `test_session_delete` | 会话删除 |
| `test_pagination` | 分页加载 |
| `test_session_search` | 会话搜索 |

## 截图

测试过程中会自动截图，保存在 `screenshots/` 目录：

```
screenshots/
├── 00_initial.png          # 初始页面
├── 01_page_load.png        # 页面加载
├── 02_ui_elements.png      # UI 元素
├── 03_message_input.png    # 消息输入
├── 04_skill_selector.png   # 技能选择器
├── 05_agent_selector.png   # Agent 选择器
├── ...
└── 28_session_search.png   # 会话搜索
```

## 测试报告

运行完成后会输出测试报告：

```
======================================================================
  测试结果汇总
======================================================================
  ✓ [connection] 页面加载
  ✓ [connection] UI 元素
  ✓ [connection] 响应式设计
  ✓ [messaging] 消息输入
  ✓ [messaging] 多行输入
  ✓ [messaging] 斜杠命令
  ✓ [messaging] @ 提及
  ✓ [messaging] 文件上传
  ✓ [messaging] 消息显示
  ✓ [messaging] 代码块渲染
  ✓ [sessions] 新建会话
  ✓ [sessions] 历史面板
  ✓ [sessions] 会话列表
  ✓ [sessions] 项目切换
  ✓ [sessions] 会话重命名

----------------------------------------------------------------------
  总计: 15 通过, 0 失败
======================================================================
```

## 前置条件

1. **启动 Web UI**:
   ```bash
   cd apps/web
   npm run dev
   ```

2. **启动后端服务器** (可选，部分测试需要):
   ```bash
   cd apps/server
   npm start
   ```

## 扩展测试

添加新测试：

```python
# test_new_feature.py
from playwright.sync_api import sync_playwright

CHAT_UI_URL = "http://localhost:3001"

def test_new_feature():
    """测试新功能"""
    print("\n=== 测试: 新功能 ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(CHAT_UI_URL)
        page.wait_for_load_state('networkidle')

        # 测试逻辑...

        browser.close()

    print("  ✓ 新功能测试通过")

if __name__ == "__main__":
    test_new_feature()
```

## 故障排除

### Playwright 安装失败

```bash
# 使用镜像
pip install playwright -i https://pypi.tuna.tsinghua.edu.cn/simple

# 或手动下载浏览器
python -m playwright install chromium
```

### 页面加载超时

```python
# 增加超时时间
page.goto(CHAT_UI_URL, timeout=60000)
page.wait_for_load_state('networkidle', timeout=30000)
```

### 元素未找到

```python
# 使用更宽松的选择器
page.locator('text=/pattern/i')  # 正则匹配
page.locator('[class*="keyword"]')  # 类名包含
page.wait_for_selector('selector', timeout=10000)  # 等待元素
```
