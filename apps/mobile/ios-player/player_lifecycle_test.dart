import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../lib/screens/torrent_player_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('torrent_player/engine');
  final calls = <String>[];
  var running = true;
  var reason = '';
  Map<String, dynamic> status() => {
    'running': running, 'baseUrl': 'http://127.0.0.1:1', 'cachePath': '/cache',
    'reason': reason, 'backgroundStatus': 'background status',
  };
  Widget app() => MaterialApp(home: TorrentPlayerScreen(client: MockClient((_) async => http.Response('{"tasks":[]}', 200))));
  setUp(() {
    calls.clear(); running = true; reason = '';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      if (call.method == 'start') running = true;
      return status();
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });

  Future<void> lifecycle(WidgetTester tester, AppLifecycleState state) async {
    tester.binding.handleAppLifecycleStateChanged(state);
    await tester.pump(); await tester.pump();
  }

  Future<void> nativeStopped(WidgetTester tester) async {
    final data = const StandardMethodCodec().encodeMethodCall(const MethodCall('engineStopped', {'reason': 'interrupted'}));
    tester.binding.channelBuffers.push('torrent_player/engine', data, (_) {});
    await tester.pump();
  }

  testWidgets('background keeps native session; interruption requires explicit recovery', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    // HTTP isolates lifecycle decisions; native integration separately exercises I/O.
    expect(calls.where((c) => c == 'start').length, 1);
    await lifecycle(tester, AppLifecycleState.paused);
    expect(calls, isNot(contains('stop')));
    running = false; reason = 'interrupted';
    await nativeStopped(tester);
    await lifecycle(tester, AppLifecycleState.resumed);
    expect(calls.where((c) => c == 'start').length, 1);
    expect(find.text('恢复下载'), findsOneWidget);
    await tester.tap(find.text('恢复下载'));
    await tester.pump(); await tester.pump();
    expect(calls.where((c) => c == 'start').length, 2);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(calls, contains('stop'));
  });

  testWidgets('limited background expiry resumes when foreground returns', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    await lifecycle(tester, AppLifecycleState.paused);
    running = false; reason = 'budgetExpired';
    await lifecycle(tester, AppLifecycleState.resumed);
    await tester.pump(); await tester.pump();
    expect(calls.where((c) => c == 'start').length, 2);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });

  testWidgets('foreground retains session and background request requires user action', (tester) async {
    await tester.pumpWidget(app());
    await tester.pumpAndSettle();
    await lifecycle(tester, AppLifecycleState.paused);
    await lifecycle(tester, AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(calls.where((c) => c == 'start').length, 1);
    expect(calls, isNot(contains('enableBackground')));
    await tester.tap(find.text('后台继续下载'));
    await tester.pumpAndSettle();
    expect(calls.where((c) => c == 'enableBackground').length, 1);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });
}
