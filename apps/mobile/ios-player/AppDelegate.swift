import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let engineQueue = DispatchQueue(label: "player.torrent.engine")
  private var channel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    guard let controller = window?.rootViewController as? FlutterViewController else { return false }
    let channel = FlutterMethodChannel(name: "torrent_player/engine", binaryMessenger: controller.binaryMessenger)
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      if call.method == "start" {
        guard let args = call.arguments as? [String: Any], let token = args["token"] as? String, token.count >= 32 else {
          result(FlutterError(code: "arguments", message: "Invalid session secret", details: nil)); return
        }
        self.engineQueue.async {
          do {
            var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
              .appendingPathComponent("TorrentPlayer", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try root.setResourceValues(values)
            let port = root.path.withCString { path in token.withCString { secret in
              TorrentStart(UnsafeMutablePointer(mutating: path), UnsafeMutablePointer(mutating: secret))
            } }
            DispatchQueue.main.async {
              if port > 0 { result(["baseUrl": "http://127.0.0.1:\(port)", "cachePath": root.path]) }
              else { result(FlutterError(code: "engine", message: "本机下载引擎启动失败，请保留数据并查看诊断日志", details: nil)) }
            }
          } catch {
            DispatchQueue.main.async { result(FlutterError(code: "storage", message: error.localizedDescription, details: nil)) }
          }
        }
      } else if call.method == "stop" {
        self.engineQueue.async { TorrentStop(); DispatchQueue.main.async { result(nil) } }
      } else { result(FlutterMethodNotImplemented) }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
