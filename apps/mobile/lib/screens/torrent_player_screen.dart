import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:video_player/video_player.dart';

class TorrentPlayerScreen extends StatefulWidget {
  const TorrentPlayerScreen({super.key});
  @override
  State<TorrentPlayerScreen> createState() => _TorrentPlayerScreenState();
}

class _TorrentPlayerScreenState extends State<TorrentPlayerScreen> {
  final _address = TextEditingController();
  final _token = TextEditingController();
  final _magnet = TextEditingController();
  final _http = http.Client();
  VideoPlayerController? _player;
  List<Map<String, dynamic>> _tasks = [];
  Map<String, dynamic>? _selected;
  String _status = '在电脑播放器中开启手机连接，然后填写地址和配对令牌。';
  String? _error;
  int _revision = 0;

  Uri _base() {
    final uri = Uri.tryParse(_address.text.trim());
    if (uri == null || !['http', 'https'].contains(uri.scheme) || uri.host.isEmpty ||
        uri.userInfo.isNotEmpty || uri.hasQuery || uri.hasFragment ||
        (uri.path.isNotEmpty && uri.path != '/')) {
      throw const FormatException('请输入电脑显示的 http://地址:端口');
    }
    if (_token.text.trim().isEmpty) throw const FormatException('请输入配对令牌');
    return uri;
  }

  Future<dynamic> _request({String? magnet}) async {
    final url = _base().resolve('/api/torrents');
    final headers = {'Authorization': 'Bearer ${_token.text.trim()}', 'Content-Type': 'application/json'};
    final response = await (magnet == null ? _http.get(url, headers: headers)
        : _http.post(url, headers: headers, body: jsonEncode({'magnet': magnet})))
        .timeout(const Duration(seconds: 70));
    final data = jsonDecode(utf8.decode(response.bodyBytes));
    if (response.statusCode != 200) throw Exception(data is Map ? data['error'] : '连接失败');
    return data;
  }

  void _stop() {
    final old = _player;
    _player = null;
    if (old != null) unawaited(old.dispose());
  }

  Future<void> _load({bool add = false}) async {
    final revision = ++_revision;
    setState(() { _stop(); _selected = null; _tasks = []; _error = null; _status = add ? '正在解析磁力链接…' : '正在连接电脑…'; });
    try {
      final data = await _request(magnet: add ? _magnet.text.trim() : null);
      if (!mounted || revision != _revision) return;
      setState(() {
        _tasks = (add ? [data] : data as List).map((item) => Map<String, dynamic>.from(item as Map)).toList();
        _selected = add ? _tasks.first : null;
        _status = _tasks.isEmpty ? '电脑暂无任务，可输入磁力链接添加。' : '请选择任务和视频文件';
      });
    } catch (error) {
      if (mounted && revision == _revision) setState(() => _error = '$error');
    }
  }

  Future<void> _play(String file) async {
    final task = _selected;
    if (task == null) return;
    final revision = ++_revision;
    setState(() { _stop(); _error = null; _status = '正在缓冲…'; });
    try {
      final url = _base().resolve('/stream/${Uri.encodeComponent(task['id'] as String)}')
          .replace(queryParameters: {'file': file, 'token': _token.text.trim()});
      // ponytail: rung 4 - reuse video_player's native AVPlayer on iOS.
      final player = VideoPlayerController.networkUrl(url);
      setState(() => _player = player);
      await player.initialize();
      if (!mounted || revision != _revision) return;
      await player.play();
      if (mounted && revision == _revision) setState(() => _status = '播放中：$file');
    } catch (_) {
      if (mounted && revision == _revision) setState(() => _error = '无法播放，请检查电脑连接和视频编码');
    }
  }

  @override
  void dispose() {
    _revision++;
    _stop();
    _http.close();
    _address.dispose();
    _token.dispose();
    _magnet.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    final files = ((_selected?['files'] as List?) ?? [])
        .map((item) => Map<String, dynamic>.from(item as Map))
        .where((file) => RegExp(r'\.(mp4|m4v)$', caseSensitive: false).hasMatch(file['name'] as String)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('磁力播放器')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _address, keyboardType: TextInputType.url,
          decoration: const InputDecoration(labelText: '电脑服务地址', hintText: 'http://192.168.1.10:端口')),
        TextField(controller: _token, obscureText: true, autocorrect: false, enableSuggestions: false,
          decoration: const InputDecoration(labelText: '配对令牌')),
        FilledButton(onPressed: () => _load(), child: const Text('连接 / 刷新任务')),
        const SizedBox(height: 16),
        TextField(controller: _magnet, autocorrect: false,
          decoration: const InputDecoration(labelText: '磁力链接')),
        FilledButton(onPressed: () => _load(add: true), child: const Text('在电脑上下载')),
        Text(_status),
        if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
        for (final task in _tasks)
          ListTile(title: Text(task['name'] as String), selected: _selected?['id'] == task['id'],
            onTap: () { _revision++; setState(() { _stop(); _selected = task; _error = null; }); }),
        for (final file in files)
          ListTile(title: Text(file['name'] as String), leading: const Icon(Icons.play_circle_outline),
            onTap: () => _play(file['path'] as String)),
        if (_selected != null && files.isEmpty) const Text('此任务没有首版支持的 MP4/M4V 视频。'),
        if (player != null)
          ValueListenableBuilder<VideoPlayerValue>(valueListenable: player, builder: (context, value, _) {
            if (value.hasError) return const Text('解码失败或连接中断，请重新选择文件');
            if (!value.isInitialized) return const Center(child: CircularProgressIndicator());
            return Column(children: [
              AspectRatio(aspectRatio: value.aspectRatio > 0 ? value.aspectRatio : 16 / 9, child: VideoPlayer(player)),
              if (value.isBuffering) const LinearProgressIndicator(),
              VideoProgressIndicator(player, allowScrubbing: true, padding: const EdgeInsets.symmetric(vertical: 12)),
              IconButton(tooltip: value.isPlaying ? '暂停' : '播放', icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
                onPressed: () async {
                  try { if (value.isPlaying) { await player.pause(); } else { await player.play(); } }
                  catch (_) { if (mounted) setState(() => _error = '播放操作失败，请重新选择文件'); }
                }),
            ]);
          }),
      ]),
    );
  }
}
