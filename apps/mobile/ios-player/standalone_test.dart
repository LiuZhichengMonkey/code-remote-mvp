import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';

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
      await api('/api/torrents/$id/delete', {});
      expect(((await api('/api/torrents'))['tasks'] as List).where((t) => t['id'] == id), isEmpty);
    } finally {
      client.close();
      await channel.invokeMethod<void>('stop');
    }
  });
}
