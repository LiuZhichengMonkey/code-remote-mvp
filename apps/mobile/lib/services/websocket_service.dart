import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum WebSocketConnectionState {
  disconnected,
  connecting,
  connected,
  error,
}

class WebSocketService {
  WebSocketChannel? _channel;

  final StreamController<String> _messageController =
      StreamController<String>.broadcast();
  final StreamController<WebSocketConnectionState> _stateController =
      StreamController<WebSocketConnectionState>.broadcast();
  final StreamController<String> _errorController =
      StreamController<String>.broadcast();

  Stream<String> get messageStream => _messageController.stream;
  Stream<WebSocketConnectionState> get connectionStateStream => _stateController.stream;
  Stream<String> get errorStream => _errorController.stream;

  WebSocketConnectionState _currentState = WebSocketConnectionState.disconnected;

  WebSocketConnectionState get currentState => _currentState;

  Future<bool> connect(String url, String token) async {
    setState(WebSocketConnectionState.connecting);

    try {
      // Prepare WebSocket URL
      String wsUrl = url;
      if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
        wsUrl = 'ws://$wsUrl';
      }

      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));

      // Listen to incoming messages
      _channel!.stream.listen(
        (message) {
          try {
            final data = jsonDecode(message);
            if (data['type'] == 'auth_success') {
              setState(WebSocketConnectionState.connected);
            } else if (data['type'] == 'auth_failed') {
              setState(WebSocketConnectionState.error);
              _errorController.add('Authentication failed. Check your token.');
            } else if (data['type'] == 'message' || data['content'] != null) {
              _messageController.add(data['content'] ?? message);
            } else {
              _messageController.add(message);
            }
          } catch (e) {
            _messageController.add(message);
          }
        },
        onError: (error) {
          setState(WebSocketConnectionState.error);
          _errorController.add('Connection error: $error');
        },
        onDone: () {
          setState(WebSocketConnectionState.disconnected);
        },
      );

      // Send authentication
      _channel!.sink.add(
        jsonEncode({'type': 'auth', 'token': token}),
      );

      // Save credentials
      await saveConnectionInfo(url, token);

      return true;
    } catch (e) {
      setState(WebSocketConnectionState.error);
      _errorController.add('Failed to connect: $e');
      return false;
    }
  }

  Future<void> sendMessage(String content) async {
    if (_channel != null && _currentState == WebSocketConnectionState.connected) {
      if (content.trim().isEmpty) return;

      _channel!.sink.add(
        jsonEncode({'type': 'message', 'content': content}),
      );
    }
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    setState(WebSocketConnectionState.disconnected);
  }

  void setState(WebSocketConnectionState state) {
    _currentState = state;
    _stateController.add(state);
  }

  Future<void> saveConnectionInfo(String url, String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', url);
    await prefs.setString('auth_token', token);
  }

  Future<Map<String, String?>?> loadConnectionInfo() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('server_url');
    final token = prefs.getString('auth_token');

    if (url != null && token != null) {
      return {'url': url, 'token': token};
    }
    return null;
  }

  Future<void> clearConnectionInfo() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('server_url');
    await prefs.remove('auth_token');
  }

  void dispose() {
    _channel?.sink.close();
    _messageController.close();
    _stateController.close();
    _errorController.close();
  }
}
