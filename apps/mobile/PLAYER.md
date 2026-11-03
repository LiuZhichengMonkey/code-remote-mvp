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

Windows 已通过 6 项 Go 测试：认证和输入边界、任务去重及恢复、损坏状态保留、真实本地 BT 节点传输与 Range/HEAD、重启离线读取、删除中断恢复、写入失败回滚，以及等待中的视频请求取消（部分测试覆盖多项行为）。

独立版 macOS CI 编译及模拟器运行仍在验证。签名、真机安装、真机实际播放、公共磁力资源可用性与设备内存峰值尚未验证。完成后补充确切 CI 和 IPA 路径。
