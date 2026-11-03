import Flutter
import UIKit
import AVFoundation
import BackgroundTasks

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let engineQueue = DispatchQueue(label: "player.torrent.engine")
  private var channel: FlutterMethodChannel?
  private var port: Int32 = 0
  private var secret = ""
  private var cachePath = ""
  private var generation = 0
  private var monitor: Timer?
  private var readingProgress = false
  private var grace: UIBackgroundTaskIdentifier = .invalid
  private var continued: BGTask?
  private var submitted = false
  private var registered = false
  private var playing = false
  private var stopReason = ""
  private var backgroundStatus = "点击后台继续下载可申请后台运行"
  private var identifier: String { (Bundle.main.bundleIdentifier ?? "com.coderemote.torrentPlayer") + ".download" }

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    // ponytail: rung 4 - native execution grants; no Dart background scheduler.
    if #available(iOS 26.0, *) {
      registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
        guard let self = self, let task = task as? BGContinuedProcessingTask else {
          task.setTaskCompleted(success: false); return
        }
        guard self.submitted, self.port > 0 else { task.setTaskCompleted(success: false); return }
        self.submitted = false
        self.continued = task
        self.backgroundStatus = "系统已允许后台下载，仍可能因资源限制而中止"
        task.expirationHandler = { [weak self, weak task] in
          DispatchQueue.main.async {
            guard let self = self, let task = task, self.continued === task else { return }
            self.playing = false
            self.stopEngine(reason: "interrupted") { task.setTaskCompleted(success: false) }
          }
        }
        self.endGrace()
        self.updateProgress()
      }
    }
    NotificationCenter.default.addObserver(self, selector: #selector(audioInterrupted(_:)),
      name: AVAudioSession.interruptionNotification, object: nil)
    guard let controller = window?.rootViewController as? FlutterViewController else { return false }
    let channel = FlutterMethodChannel(name: "torrent_player/engine", binaryMessenger: controller.binaryMessenger)
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      switch call.method {
      case "start":
        guard let args = call.arguments as? [String: Any], let token = args["token"] as? String, token.count >= 32 else {
          result(FlutterError(code: "arguments", message: "Invalid session secret", details: nil)); return
        }
        self.startEngine(token: token, result: result)
      case "stop":
        self.playing = false
        self.stopEngine(reason: "stopped") { result(nil) }
      case "status": result(self.status())
      case "enableBackground":
        self.enableBackground()
        result(self.status())
      case "playback":
        let active = (call.arguments as? [String: Any])?["active"] as? Bool ?? false
        do {
          if active {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .moviePlayback)
            try audio.setActive(true)
          }
          self.playing = active
          if !active && UIApplication.shared.applicationState == .background { self.beginGrace() }
          result(nil)
        } catch { result(FlutterError(code: "audio", message: error.localizedDescription, details: nil)) }
      #if DEBUG
      case "testExpireBackground":
        // Exercise the production expiration path without claiming OS scheduling.
        self.playing = false
        self.stopEngine(reason: "interrupted") { result(nil) }
      #endif
      default: result(FlutterMethodNotImplemented)
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func status() -> [String: Any] {
    return ["running": port > 0, "baseUrl": "http://127.0.0.1:\(port)", "cachePath": cachePath,
      "reason": stopReason, "backgroundStatus": backgroundStatus,
      "backgroundActive": continued != nil, "backgroundRequested": submitted]
  }

  private func startEngine(token: String, result: @escaping FlutterResult) {
    if port > 0 {
      guard token == secret else { result(FlutterError(code: "session", message: "Session already active", details: nil)); return }
      result(status()); return
    }
    generation += 1
    let revision = generation
    engineQueue.async {
      do {
        var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
          .appendingPathComponent("TorrentPlayer", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try root.setResourceValues(values)
        // Files remain accessible after first unlock while the phone is locked.
        // New child files inherit this directory's native protection class.
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
        let port = root.path.withCString { path in token.withCString { secret in
          TorrentStart(UnsafeMutablePointer(mutating: path), UnsafeMutablePointer(mutating: secret))
        } }
        DispatchQueue.main.async {
          guard revision == self.generation else {
            result(FlutterError(code: "cancelled", message: "Engine start superseded", details: nil)); return
          }
          guard port > 0 else {
            result(FlutterError(code: "engine", message: "本机下载引擎启动失败，请保留数据并查看诊断日志", details: nil)); return
          }
          self.port = port; self.secret = token; self.cachePath = root.path; self.stopReason = ""
          self.monitor?.invalidate()
          self.monitor = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.updateProgress() }
          if UIApplication.shared.applicationState == .background { self.beginGrace() }
          result(self.status())
        }
      } catch {
        DispatchQueue.main.async { result(FlutterError(code: "storage", message: error.localizedDescription, details: nil)) }
      }
    }
  }

  private func enableBackground() {
    guard port > 0, UIApplication.shared.applicationState == .active else {
      backgroundStatus = "请在 App 前台添加或继续任务后申请后台下载"; return
    }
    if continued != nil || submitted { return }
    if #available(iOS 26.0, *), registered {
      let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: "磁力下载", subtitle: "正在连接节点和读取下载进度")
      request.strategy = .fail
      submitted = true
      do {
        try BGTaskScheduler.shared.submit(request)
        backgroundStatus = "已申请后台下载，等待系统确认"
      } catch {
        submitted = false
        backgroundStatus = "系统暂未允许持续后台下载；切后台后仅有有限运行时间"
        NSLog("Background download request rejected: %@", error.localizedDescription)
      }
    } else {
      backgroundStatus = "此系统仅支持有限后台下载时间；回到前台可继续"
    }
  }

  private func updateProgress() {
    guard port > 0, !readingProgress else { return }
    readingProgress = true
    let revision = generation
    engineQueue.async {
      var done: Int64 = 0, total: Int64 = 0
      let pending = TorrentProgress(&done, &total)
      DispatchQueue.main.async {
        self.readingProgress = false
        guard revision == self.generation, self.port > 0 else { return }
        if #available(iOS 26.0, *), let task = self.continued as? BGContinuedProcessingTask {
          task.progress.totalUnitCount = max(1, total)
          task.progress.completedUnitCount = min(done, total)
          let subtitle = total > 1 ? "已下载 \(ByteCountFormatter.string(fromByteCount: done, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: total, countStyle: .file))" : "正在获取磁力信息"
          task.updateTitle("磁力下载 · \(pending) 个未完成任务", subtitle: subtitle)
        }
        if pending == 0 {
          self.finishContinued(success: true)
          self.backgroundStatus = "下载已完成或任务已暂停"
          if UIApplication.shared.applicationState == .background && !self.playing {
            self.stopEngine(reason: "idle") {}
          }
        }
      }
    }
  }

  private func finishContinued(success: Bool) {
    if submitted { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier); submitted = false }
    let task = continued
    continued = nil
    task?.expirationHandler = nil
    task?.setTaskCompleted(success: success)
  }

  private func stopEngine(reason: String, completion: @escaping () -> Void) {
    generation += 1
    port = 0
    stopReason = reason
    monitor?.invalidate(); monitor = nil
    // Expiration completes its task after disk/network shutdown, exactly once.
    if reason == "interrupted" {
      continued?.expirationHandler = nil; continued = nil
      submitted = false
      backgroundStatus = "后台下载被系统结束或取消；点击恢复下载，缓存已保留"
    } else { finishContinued(success: reason == "idle") }
    let heldGrace = grace
    grace = .invalid
    channel?.invokeMethod("engineStopped", arguments: ["reason": reason])
    engineQueue.async {
      TorrentStop()
      DispatchQueue.main.async {
        if heldGrace != .invalid { UIApplication.shared.endBackgroundTask(heldGrace) }
        completion()
      }
    }
  }

  private func beginGrace() {
    guard port > 0, continued == nil, grace == .invalid else { return }
    grace = UIApplication.shared.beginBackgroundTask(withName: "Finish torrent writes") { [weak self] in
      guard let self = self else { return }
      if self.playing {
        // Actual AVPlayer audio owns background eligibility; never play silent audio.
        self.endGrace()
      } else {
        self.stopEngine(reason: "budgetExpired") {}
      }
    }
    if grace == .invalid && !playing { stopEngine(reason: "budgetExpired") {} }
  }

  private func endGrace() {
    if grace != .invalid { UIApplication.shared.endBackgroundTask(grace); grace = .invalid }
  }

  override func applicationDidEnterBackground(_ application: UIApplication) {
    beginGrace()
    super.applicationDidEnterBackground(application)
  }

  override func applicationWillEnterForeground(_ application: UIApplication) {
    endGrace()
    super.applicationWillEnterForeground(application)
  }

  @objc private func audioInterrupted(_ notification: Notification) {
    guard let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      type == AVAudioSession.InterruptionType.began.rawValue else { return }
    DispatchQueue.main.async {
      self.playing = false
      self.channel?.invokeMethod("playbackInterrupted", arguments: nil)
      if UIApplication.shared.applicationState == .background { self.beginGrace() }
    }
  }
}
