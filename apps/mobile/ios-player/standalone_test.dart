import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:coderemote_mvp/screens/torrent_player_screen.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:video_player/video_player.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('embedded iOS engine starts, deduplicates and restores local tasks', (tester) async {
    const channel = MethodChannel('torrent_player/engine');
    const token = 'simulator-native-engine-test-secret-0123456789';
    const magnet = 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789';
    final client = http.Client();
    var base = '';
    Future<Map<String, dynamic>> api(String path, [Map<String, dynamic>? body]) async {
      final uri = Uri.parse('$base$path');
      final headers = {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};
      final response = await (body == null ? client.get(uri, headers: headers)
        : client.post(uri, headers: headers, body: jsonEncode(body))).timeout(const Duration(seconds: 15));
      expect(response.statusCode, 200, reason: response.body);
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    try {
      final start = await channel.invokeMapMethod<String, dynamic>('start', {'token': token});
      base = start!['baseUrl'] as String;
      if (start['continuedSupported'] == true) {
        expect(start['backgroundRegistered'], true, reason: 'Native background handler must match the permitted plist identifier');
      }
      expect(Uri.parse(base).host, '127.0.0.1');
      final unauthorized = await client.get(Uri.parse('$base/api/torrents'));
      expect(unauthorized.statusCode, 401);
      final first = await api('/api/torrents', {'magnet': magnet});
      final duplicate = await api('/api/torrents', {'magnet': '$magnet&dn=same'});
      expect(first['id'], duplicate['id']);
      final id = first['id'] as String;
      await api('/api/torrents/$id/pause', {});
      await channel.invokeMethod<void>('stop');
      final restored = await channel.invokeMapMethod<String, dynamic>('start', {'token': token});
      base = restored!['baseUrl'] as String;
      final tasks = (await api('/api/torrents'))['tasks'] as List;
      expect(tasks.where((t) => t['id'] == id).single['paused'], true);
      await api('/api/torrents/$id/resume', {});
      final background = await channel.invokeMapMethod<String, dynamic>('enableBackground');
      expect(background!['backgroundStatus'], isA<String>());
      final retained = await channel.invokeMapMethod<String, dynamic>('status');
      expect(retained!['running'], true);
      expect(retained['baseUrl'], base);
      await channel.invokeMethod<void>('testExpireBackground');
      final expired = await channel.invokeMapMethod<String, dynamic>('status');
      expect(expired!['running'], false);
      expect(expired['reason'], 'interrupted');
      final restarted = await channel.invokeMapMethod<String, dynamic>('start', {'token': token});
      base = restarted!['baseUrl'] as String;
      final recovered = (await api('/api/torrents'))['tasks'] as List;
      expect(recovered.where((t) => t['id'] == id).single['paused'], false);
      await api('/api/torrents/$id/delete', {});
      expect(((await api('/api/torrents'))['tasks'] as List).where((t) => t['id'] == id), isEmpty);
    } finally {
      client.close();
      await channel.invokeMethod<void>('stop');
    }
  });

  testWidgets('AVPlayer plays and seeks before a real BT file finishes downloading', (tester) async {
    const magnet = String.fromEnvironment('magnet');
    expect(magnet, isNotEmpty, reason: 'CI must start the throttled local seeder');
    const channel = MethodChannel('torrent_player/engine');
    const token = 'simulator-video-stream-test-secret-0123456789';
    final client = http.Client();
    VideoPlayerController? player;
    var base = '';
    Future<Map<String, dynamic>> api(String path, [Map<String, dynamic>? body]) async {
      final uri = Uri.parse('$base$path');
      final headers = {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};
      final response = await (body == null ? client.get(uri, headers: headers)
        : client.post(uri, headers: headers, body: jsonEncode(body))).timeout(const Duration(seconds: 15));
      expect(response.statusCode, 200, reason: response.body);
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    Future<void> until(bool Function() ready) async {
      final deadline = DateTime.now().add(const Duration(seconds: 90));
      while (!ready()) {
        expect(DateTime.now().isBefore(deadline), true, reason: 'Video playback timed out: ${player?.value}');
        expect(player?.value.hasError ?? false, false, reason: player?.value.errorDescription);
        await tester.pump(const Duration(milliseconds: 200));
      }
    }
    try {
      final started = await channel.invokeMapMethod<String, dynamic>('start', {'token': token});
      base = started!['baseUrl'] as String;
      final id = (await api('/api/torrents', {'magnet': magnet}))['id'] as String;
      final deadline = DateTime.now().add(const Duration(seconds: 30));
      Map<String, dynamic> task;
      do {
        final tasks = (await api('/api/torrents'))['tasks'] as List;
        task = Map<String, dynamic>.from(tasks.singleWhere((t) => t['id'] == id) as Map);
        expect(DateTime.now().isBefore(deadline), true, reason: 'No metadata from local seed: $task');
        if (task['metadata'] != true) await tester.pump(const Duration(milliseconds: 200));
      } while (task['metadata'] != true);
      final url = Uri.parse('$base/stream/$id').replace(queryParameters: {'file': '0', 'token': token});
      final controller = VideoPlayerController.networkUrl(url);
      player = controller;
      await controller.initialize().timeout(const Duration(seconds: 90));
      expect(controller.value.duration.inSeconds, greaterThanOrEqualTo(11));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: TorrentVideoView(controller: controller))));
      await controller.play();
      await until(() => controller.value.position.inMilliseconds > 700);
      // Exercise actual touch controls, rather than calling seekTo directly.
      await controller.pause();
      await tester.pump();
      var slider = tester.getRect(find.byKey(const ValueKey('playback-slider')));
      await tester.tapAt(Offset(slider.left + slider.width * 0.25, slider.center.dy));
      await until(() => controller.value.position.inMilliseconds > 1500 && controller.value.position.inMilliseconds < 4000);
      expect(controller.value.isPlaying, false, reason: 'Scrubbing a paused video must preserve pause');
      await tester.tap(find.byTooltip('全屏播放'));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byTooltip('退出全屏'), findsOneWidget);
      expect(tester.widget<TorrentVideoView>(find.byType(TorrentVideoView).last).fullscreen, true);
      expect(tester.takeException(), isNull, reason: 'Landscape fullscreen must fit controls and video');
      await tester.tap(find.byTooltip('播放'));
      await tester.pump();
      slider = tester.getRect(find.byKey(const ValueKey('playback-slider')));
      final gesture = await tester.startGesture(Offset(slider.left + slider.width * 0.25, slider.center.dy));
      await gesture.moveTo(Offset(slider.left + slider.width * 0.70, slider.center.dy));
      await gesture.up();
      await until(() => controller.value.position.inMilliseconds > 8700);
      expect(controller.value.isPlaying, true, reason: 'Fullscreen drag must preserve playback');
      await tester.tap(find.byTooltip('退出全屏'));
      await tester.pump(const Duration(seconds: 1));
      expect(find.byTooltip('全屏播放'), findsOneWidget);
      expect(controller.value.position.inMilliseconds, greaterThan(8700));
      expect(controller.value.isPlaying, true, reason: 'Leaving fullscreen must retain the same session');
      final tasks = (await api('/api/torrents'))['tasks'] as List;
      task = Map<String, dynamic>.from(tasks.singleWhere((t) => t['id'] == id) as Map);
      expect(task['done'] as num, greaterThan(0));
      expect(task['done'] as num, lessThan(task['total'] as num), reason: 'Playback must finish its assertions before the download completes');
      debugPrint('PASS actual AVPlayer decode/play/seek while BT incomplete: ${task['done']}/${task['total']} bytes, position=${controller.value.position}');
      debugPrint('PASS actual touch slider, paused scrubbing, landscape fullscreen and return without restarting');
      await tester.pumpWidget(const SizedBox());
      await controller.dispose();
      player = null;
      await api('/api/torrents/$id/delete', {});
    } finally {
      await player?.dispose();
      client.close();
      await channel.invokeMethod<void>('stop');
    }
  });
}
