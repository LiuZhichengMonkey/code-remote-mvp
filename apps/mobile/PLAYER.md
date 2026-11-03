# iOS 独立磁力播放器

本版本在 iPhone 内嵌 BT 引擎：磁力解析、连接节点、下载、缓存和播放都在本机完成，无需电脑服务。

## 使用

1. 给未签名 IPA 签名后安装到 iPhone。
2. 打开 App，粘贴含 `urn:btih` 的磁力链接，点击「添加并在手机下载」。
3. 等待资源节点提供磁力信息，点击任务，再选择视频文件。播放读取会优先请求所需片段，可在下载完成前开始播放。
4. 任务显示下载速度、节点数、已下载量和总量；支持暂停、继续及确认后删除任务和缓存。

当前通过原生 AVPlayer 支持 MP4/M4V/MOV 容器，能否解码取决于其中的视频/音频编码和设备。下载速度取决于资源做种、网络和节点连接情况。

请保持 App 在前台下载。进入后台时关闭 BT 会话，回到前台恢复任务。首版不承诺锁屏持续下载或后台播放。

## 缓存和恢复

数据位于应用私有 `Library/Application Support/TorrentPlayer/data/<infohash>/`，任务列表为同级 `tasks.json`，种子信息保存于 `metadata/`，不上传 iCloud 备份。

视频占用手机磁盘；BT 引擎、系统文件缓存和解码器也会使用运行内存。读取预取窗口为 8 MiB，Go 堆软目标为 128 MiB，均不是整个 App 的内存上限。当前无自动磁盘配额，需要在任务卡片中清理缓存。

任务以 infohash 去重。重启会恢复任务、暂停状态和已保存的种子信息。写入异常会显示错误并暂停该任务；无法解析的状态文件不会被自动覆盖。删除使用持久化标记，中途退出后可重试清理。

## 构建

独立入口：`lib/main_player.dart`。GitHub 分支：`build/ios-player`。

`.github/workflows/player-ios.yml` 在 macOS 上生成完整独立 Flutter iOS 工程；`scripts/build-player-torrent-ios.sh` 编译固定版本的 Go BT 引擎为 iPhone/模拟器 C 静态库，`scripts/configure-player-ios.rb` 配置链接。仓库的 mobile 目录本身不含完整 Xcode 工程，不能仅复制旧 Info.plist 当作可用 iOS 工程。

引擎为未修改的 `github.com/anacrolix/torrent v1.58.1`，不依赖不可获取的第三方预编译框架。依赖固定在 go.mod/go.sum。签名包同时包含播放器源码、引擎源码压缩包、模块清单及第三方说明。

未签名 IPA 需要自己的 Apple 签名和匹配描述文件，最低 iOS 13.0、arm64。此前构建 41486016858 是依赖电脑的旧版，不代表独立版。

## 验证

2026-11-03：提交 `c0fd176677df9eb91b5ef182fa91eaa93bf5dae5` 的 [完整 CI 41584413771](https://github.com/LiuZhichengMonkey/code-remote-mvp/actions/runs/41584413771) **全部成功**：6 项 Go 测试及竞态检测、Dart 分析、模拟器编译、iPhone release 编译、IPA 打包，以及真实 iPhone 模拟器内的 Swift/C/Go 引擎集成测试。模拟器测试验证原生桥接启动、未认证请求拒绝、任务添加和去重、暂停、停止重启后的暂停状态恢复、继续、删除。

最终交付：`runtime/player-ios-standalone-41584413771/TorrentPlayer-unsigned.ipa`，12,264,275 字节；SHA256 `0a462458b704206e2bdd18d3a20b490430f1a22a2ff145e262fde9d206c9cd25`。已复核 ZIP 完整性、arm64/iPhoneOS、内嵌 BT 导出符号、无描述文件，以及源码和依赖附件。检查记录在同目录 `verification.json`，CI 锁文件和模拟器诊断在 `build-evidence/`；完整日志在 `runtime/player-ios-build-41584413771.log`。

签名、真机安装、AVPlayer 实际影片解码、拖动播放的设备表现、后台持续下载和设备内存峰值仍未验证。模拟器引擎管理通过不等于真机影片播放通过。

Windows 已通过 6 项 Go 测试：认证和输入边界、任务去重及恢复、损坏状态保留、真实本地 BT 节点传输与 Range/HEAD、重启离线读取、删除中断恢复、写入失败回滚，以及等待中的视频请求取消（部分测试覆盖多项行为）。

另用同一 Go 引擎在 Windows 上测试了 WebTorrent 官方公开资源 Big Buck Bunny（infohash `dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c`）：从磁力获取元信息、连接公共节点、下载并通过 HTTP 206 读取 1024 字节 MP4 文件头（`ftyp`）成功。日志为 `runtime/standalone-public-probe.log`；这不代表已验证完整影片播放或 iPhone 下载速度。

独立版提交 `c22d1ac` 的 [macOS 构建](https://github.com/LiuZhichengMonkey/code-remote-mvp/actions/runs/41581420845) 已通过引擎竞态检测、Dart 分析、完整模拟器编译、iPhone release 编译和打包。但模拟器集成运行失败：App 启动后工具等待 VM Service 地址达 12 分钟，用例未开始，因此整轮 workflow 为 failure。

本机 IPA：`runtime/player-ios-standalone-41581420845/TorrentPlayer-unsigned.ipa`，12,264,265 字节。已核对 ZIP 完整性、arm64/iPhoneOS、内嵌 TorrentStart/TorrentStop 符号及源码/依赖说明附件。SHA256：`57529f002ef6d4daadb85b960cb734ec6cc35a3e10aa007b6bd67958d6d7ea88`。同目录 `verification.json` 保存检查结果。

签名、真机安装、真机实际播放与设备内存峰值尚未验证。此前模拟器测试 run `41579627556` 在安装测试 App 时达到 10 分钟时限，测试用例未开始，不计为运行通过；本轮将首次开机与编译重叠，并增加运行时限。

运行日志与 [Flutter 官方修复 c3ed85e](https://github.com/flutter/flutter/commit/c3ed85ef987759ee54a6bce275490cde2a238dc1) 描述的模拟器日志就绪竞态一致：App 先启动，log stream 后启动，可能漏掉 VM 服务地址。CI 用 `scripts/patch-player-flutter-test.py` 将该等待逻辑移植到固定的 3.35.7 工具源码，严格匹配待替换内容；不改变应用或 Flutter engine 二进制。应用该修复后，run `41584413771` 实际执行模拟器测试并通过。
