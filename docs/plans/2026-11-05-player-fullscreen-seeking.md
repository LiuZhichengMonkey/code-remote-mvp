# 手机播放控件修复

用户报告无法全屏和拖动进度。现有 AVPlayer/HTTP Range 已在真实 BT 下载中验证过跳转；缺失的是全屏入口和明确可触摸的进度控件。复用同一个 VideoPlayerController、Flutter Material Slider、Navigator 和 SystemChrome，不引入播放器或手势依赖。

全屏切换到黑底横屏页面，原内嵌视频暂时移除，避免两个视图同时使用纹理。退出后恢复系统方向策略和界面。关闭任务时移除全屏路由。Slider 显示当前时间/总时长，拖动时显示目标时间，松手才调用 seekTo；保持原有播放或暂停状态，跳转失败显示错误。

验收使用原有限速 BT/尾部 moov MP4 夹具：实际触摸内嵌滑块、暂停跳转、进入全屏、全屏拖动、退出后同一会话继续。文件必须仍未下载完成。CI 结果另记录在 PLAYER.md。

<!-- ponytail: rung 2/4 - reuse existing AVPlayer and native Flutter controls; no new playback dependency. -->
