import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';

class TorrentPlayerScreen extends StatefulWidget {
  const TorrentPlayerScreen({super.key, this.client});
  final http.Client? client;
  @override
  State<TorrentPlayerScreen> createState() => _TorrentPlayerScreenState();
}

class _TorrentPlayerScreenState extends State<TorrentPlayerScreen> with WidgetsBindingObserver {
  static const _native = MethodChannel('torrent_player/engine');
  final _magnet = TextEditingController();
  late final http.Client _http;
  VideoPlayerController? _player;
  Timer? _timer;
  List<Map<String, dynamic>> _tasks = [];
  String? _selectedId, _base, _error;
  String _token = '', _cachePath = '', _status = '正在启动本机下载引擎…';
  String _backgroundStatus = '添加或继续任务后，可申请后台下载';
  bool _playbackActive = false;
  int _revision = 0;
  bool _busy = false, _polling = false, _foreground = true;
  Future<void> _lifecycle = Future.value();

  @override
  void initState() {
    super.initState();
    _http = widget.client ?? http.Client();
    WidgetsBinding.instance.addObserver(this);
    _native.setMethodCallHandler((call) async {
      if (!mounted) return;
      if (call.method == 'engineStopped') {
        _timer?.cancel();
        _revision++;
        setState(() {
          _stop(); _base = null;
          _status = (call.arguments as Map?)?['reason'] == 'interrupted'
            ? '后台任务已结束或取消，缓存已保留，请点击恢复下载' : '下载会话已暂停，缓存已保留';
        });
      } else if (call.method == 'playbackInterrupted') {
        await _player?.pause();
      }
    });
    _queueLifecycle(true);
  }

  void _queueLifecycle(bool start) {
    _lifecycle = _lifecycle.then((_) async {
      if (start) { if (mounted && _foreground) await _start(); }
      else { await _native.invokeMethod<void>('stop'); }
    }).catchError((Object error) {
      if (mounted) setState(() => _error = '本机引擎操作失败：$error');
    });
  }

  Future<void> _start() async {
    if (_base != null) return;
    if (_token.isEmpty) _token = List.generate(32, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final data = await _native.invokeMapMethod<String, dynamic>('start', {'token': _token});
    if (!mounted) return;
    if (data == null || data['running'] != true) throw StateError('系统未允许下载引擎继续运行，请回到前台恢复');
    setState(() { _base = data['baseUrl'] as String; _cachePath = data['cachePath'] as String; _error = null; _status = '本机下载已就绪，无需连接电脑'; _backgroundStatus = data['backgroundStatus'] as String; });
    if (!_foreground) return;
    await _refresh();
    if (!mounted || !_foreground || _base == null) return;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _foreground = false;
      _timer?.cancel();
      // ponytail: rung 4 - Swift owns background execution; keep the loopback session and AVPlayer.
    } else if (state == AppLifecycleState.detached) {
      _foreground = false;
      _timer?.cancel();
      _queueLifecycle(false);
    } else if (state == AppLifecycleState.resumed && !_foreground) {
      _foreground = true;
      _lifecycle = _lifecycle.then((_) => _reconcile()).catchError((Object error) {
        if (mounted) setState(() => _error = '恢复下载失败：$error');
      });
    }
  }

  Future<void> _reconcile() async {
    final state = await _native.invokeMapMethod<String, dynamic>('status');
    if (!mounted || !_foreground || state == null) return;
    setState(() => _backgroundStatus = state['backgroundStatus'] as String);
    if (state['running'] != true) {
      _revision++;
      setState(() { _stop(); _base = null; });
      if (state['reason'] == 'interrupted') {
        setState(() => _status = '后台任务已结束或取消，点击恢复下载继续');
        return;
      }
    }
    await _start();
    if (_base != null) {
      await _refresh();
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(seconds: 1), (_) => _refresh());
    }
  }

  Future<void> _enableBackground() async {
    try {
      final state = await _native.invokeMapMethod<String, dynamic>('enableBackground');
      if (mounted && state != null) setState(() => _backgroundStatus = state['backgroundStatus'] as String);
    } catch (error) { if (mounted) setState(() => _error = '申请后台下载失败：$error'); }
  }

  void _syncPlayback() {
    final value = _player?.value;
    final active = value != null && value.isPlaying && !value.hasError && !value.isCompleted;
    if (active == _playbackActive) return;
    _playbackActive = active;
    unawaited(_native.invokeMethod<void>('playback', {'active': active}).catchError((Object error) {
      if (mounted) setState(() => _error = '后台播放状态更新失败：$error');
    }));
  }

  Future<Map<String, dynamic>> _request(String path, {Map<String, dynamic>? body}) async {
    final base = _base;
    if (base == null) throw StateError('下载引擎尚未就绪');
    final headers = {'Authorization': 'Bearer $_token', 'Content-Type': 'application/json'};
    final url = Uri.parse('$base$path');
    final response = await (body == null ? _http.get(url, headers: headers)
      : _http.post(url, headers: headers, body: jsonEncode(body))).timeout(const Duration(seconds: 10));
    final data = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    if (response.statusCode != 200) throw Exception(data['error'] ?? '本机下载操作失败');
    return data;
  }

  Future<void> _refresh() async {
    if (_polling || _base == null) return;
    _polling = true;
    final base = _base;
    try {
      final data = await _request('/api/torrents');
      final nativeState = await _native.invokeMapMethod<String, dynamic>('status');
      if (mounted && _base == base) { setState(() {
        _tasks = (data['tasks'] as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        if (nativeState != null) _backgroundStatus = nativeState['backgroundStatus'] as String;
      }); }
    } catch (error) { if (mounted && _base == base) setState(() => _error = '$error'); }
    finally { _polling = false; }
  }

  void _stop() {
    final old = _player;
    old?.removeListener(_syncPlayback);
    _player = null;
    _syncPlayback();
    if (old != null) unawaited(old.dispose());
  }

  void _select(String id) {
    _revision++;
    setState(() { _stop(); _selectedId = id; _error = null; _status = '请选择视频文件'; });
  }

  Future<void> _add() async {
    if (_busy) return;
    setState(() { _busy = true; _error = null; });
    try {
      final data = await _request('/api/torrents', body: {'magnet': _magnet.text.trim()});
      if (!mounted) return;
      _select(data['id'] as String);
      await _refresh();
      await _enableBackground();
      if (mounted) setState(() => _status = '已添加到手机，正在寻找节点和解析文件…');
    } catch (error) { if (mounted) setState(() => _error = '$error'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _action(String id, String action) async {
    if (_busy) return;
    if (action == 'delete') {
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
        title: const Text('删除任务和手机缓存？'), content: const Text('该任务已下载的数据将被永久删除。'),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('删除'))]));
      if (confirmed != true || !mounted) return;
    }
    setState(() { _busy = true; _error = null; if (_selectedId == id) { _revision++; _stop(); } });
    try {
      await _request('/api/torrents/$id/$action', body: {});
      if (!mounted) return;
      if (action == 'delete' && _selectedId == id) setState(() => _selectedId = null);
      await _refresh();
      if (action == 'resume') await _enableBackground();
    } catch (error) { if (mounted) setState(() => _error = '$error'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _play(Map<String, dynamic> file) async {
    final id = _selectedId;
    if (id == null || _base == null) return;
    final revision = ++_revision;
    setState(() { _stop(); _error = null; _status = '正在优先下载播放所需片段…'; });
    try {
      final url = Uri.parse('$_base/stream/$id').replace(queryParameters: {'file': '${file['index']}', 'token': _token});
      // ponytail: rung 2/4 - keep the existing native AVPlayer and playback generation guard.
      final player = VideoPlayerController.networkUrl(url, videoPlayerOptions: VideoPlayerOptions(allowBackgroundPlayback: true));
      player.addListener(_syncPlayback);
      setState(() => _player = player);
      await player.initialize().timeout(const Duration(seconds: 90));
      if (!mounted || revision != _revision) return;
      _playbackActive = true;
      await _native.invokeMethod<void>('playback', {'active': true});
      if (!mounted || revision != _revision) return;
      await player.play();
      if (mounted && revision == _revision) setState(() => _status = '播放中：${file['name']}');
    } catch (error) {
      if (mounted && revision == _revision) { setState(() {
        _stop();
        _error = '暂时无法播放：$error';
      }); }
    }
  }

  String _bytes(num value) {
    var n = value.toDouble();
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var unit = 0;
    while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
    return '${n.toStringAsFixed(unit == 0 ? 0 : 1)} ${units[unit]}';
  }

  String _downloadState(Map<String, dynamic> task) {

    if (task['paused'] == true) return '已暂停';
    if ((task['error'] as String).isNotEmpty) return '下载出错';
    if (task['metadata'] == true && (task['done'] as num) >= (task['total'] as num)) return '下载完成';
    if ((task['peers'] as num) == 0) return '寻找节点（尚未连接）';
    if (task['metadata'] != true) return '已连接节点，等待文件信息';
    if ((task['speed'] as num) == 0) return '已连接节点，等待数据';
    return '正在下载';
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _native.setMethodCallHandler(null);
    _foreground = false;
    _timer?.cancel();
    _revision++;
    _stop();
    _queueLifecycle(false);
    _http.close();
    _magnet.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    final selected = _tasks.where((t) => t['id'] == _selectedId).firstOrNull;
    final files = ((selected?['files'] as List?) ?? []).map((f) => Map<String, dynamic>.from(f as Map))
      .where((f) => RegExp(r'\.(mp4|m4v|mov)$', caseSensitive: false).hasMatch(f['name'] as String)).toList();
    return Scaffold(appBar: AppBar(title: const Text('磁力播放器 · 独立版')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('视频直接下载到本机，无需电脑。后台下载时间由 iOS 决定。'),
        TextField(controller: _magnet, autocorrect: false, maxLines: 3, minLines: 1,
          decoration: const InputDecoration(labelText: '磁力链接', hintText: 'magnet:?xt=urn:btih:…')),
        FilledButton(onPressed: _base == null || _busy ? null : _add, child: Text(_busy ? '处理中…' : '添加并在手机下载')),
        Text(_status),
        Text(_backgroundStatus),
        if (_base != null) TextButton(onPressed: _busy ? null : _enableBackground, child: const Text('后台继续下载')),
        if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (_base == null && _foreground) TextButton(onPressed: () => _queueLifecycle(true), child: const Text('恢复下载')),
        if (_base != null) TextButton(onPressed: _refresh, child: const Text('刷新任务')),
        for (final t in _tasks) Card(child: Column(children: [
          ListTile(title: Text((t['name'] as String).isEmpty ? t['id'] as String : t['name'] as String),
            selected: _selectedId == t['id'], onTap: () => _select(t['id'] as String),
            subtitle: Text('${_downloadState(t)} · ${_bytes(t['speed'] as num)}/s · ${t['peers']} 节点\n${_bytes(t['done'] as num)} / ${_bytes(t['total'] as num)}'),
            isThreeLine: true),
          if ((t['total'] as num) > 0) LinearProgressIndicator(value: ((t['done'] as num) / (t['total'] as num)).clamp(0.0, 1.0)),
          if ((t['error'] as String).isNotEmpty) Padding(padding: const EdgeInsets.all(8), child: Text(t['error'] as String)),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            TextButton(onPressed: _base == null || _busy ? null : () => _action(t['id'] as String, t['paused'] == true ? 'resume' : 'pause'), child: Text(t['paused'] == true ? '继续下载' : '暂停下载')),
            TextButton(onPressed: _base == null || _busy ? null : () => _action(t['id'] as String, 'delete'), child: const Text('删除缓存')),
          ]),
        ])),
        if (selected != null && selected['metadata'] == false) const Text('正在寻找提供磁力信息的节点，可稍后重试或更换资源。'),
        for (final file in files) ListTile(title: Text(file['name'] as String), subtitle: Text(_bytes(file['size'] as num)),
          leading: const Icon(Icons.play_circle_outline), onTap: selected?['paused'] == true || _base == null ? null : () => _play(file)),
        if (selected?['metadata'] == true && files.isEmpty) const Text('当前支持 MP4/M4V/MOV 容器，实际播放还取决于设备支持的编码。'),
        if (player != null) ValueListenableBuilder<VideoPlayerValue>(valueListenable: player, builder: (context, value, _) {
          if (value.hasError) return const Text('解码失败或连接中断，请重新选择文件');
          if (!value.isInitialized) return const Center(child: CircularProgressIndicator());
          return Column(children: [
            AspectRatio(aspectRatio: value.aspectRatio > 0 ? value.aspectRatio : 16 / 9, child: VideoPlayer(player)),
            if (value.isBuffering) const LinearProgressIndicator(),
            VideoProgressIndicator(player, allowScrubbing: true, padding: const EdgeInsets.symmetric(vertical: 12)),
            IconButton(tooltip: value.isPlaying ? '暂停播放' : '播放', icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
              onPressed: () async { try { if (value.isPlaying) { await player.pause(); } else { await player.play(); } }
                catch (_) { if (mounted) setState(() => _error = '播放操作失败，请重新选择文件'); } }),
          ]);
        }),
        const SizedBox(height: 16),
        Text('缓存位置：$_cachePath/data\n下载占用手机磁盘，播放和 BT 引擎也会使用部分运行内存。'),
      ]));
  }
}
