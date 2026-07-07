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

class SessionContextState {
  final String sessionId;
  final String provider;
  final String? title;
  final int budgetTokens;
  final int estimatedTokens;
  final int remainingTokens;
  final int overflowTokens;
  final double usedPercent;
  final double remainingPercent;
  final bool isOverBudget;
  final int messageCount;
  final bool isEstimated;
  final String? reason;
  final DateTime timestamp;

  const SessionContextState({
    required this.sessionId,
    required this.provider,
    required this.budgetTokens,
    required this.estimatedTokens,
    required this.remainingTokens,
    required this.overflowTokens,
    required this.usedPercent,
    required this.remainingPercent,
    required this.isOverBudget,
    required this.messageCount,
    required this.isEstimated,
    required this.timestamp,
    this.title,
    this.reason,
  });

  factory SessionContextState.fromMessage(
    Map<String, dynamic> data,
    Map<String, dynamic> usage,
  ) {
    final sessionId = (data['sessionId'] ?? data['session_id'] ?? '').toString();
    final provider = (data['provider'] ?? '').toString();
    final title = data['title']?.toString();
    final reason = data['reason']?.toString();
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      (data['timestamp'] is int ? data['timestamp'] as int : DateTime.now().millisecondsSinceEpoch),
    );

    return SessionContextState(
      sessionId: sessionId,
      provider: provider,
      title: title,
      budgetTokens: (usage['budgetTokens'] as num?)?.toInt() ?? 0,
      estimatedTokens: (usage['estimatedTokens'] as num?)?.toInt() ?? 0,
      remainingTokens: (usage['remainingTokens'] as num?)?.toInt() ?? 0,
      overflowTokens: (usage['overflowTokens'] as num?)?.toInt() ?? 0,
      usedPercent: (usage['usedPercent'] as num?)?.toDouble() ?? 0,
      remainingPercent: (usage['remainingPercent'] as num?)?.toDouble() ?? 0,
      isOverBudget: usage['isOverBudget'] == true,
      messageCount: (usage['messageCount'] as num?)?.toInt() ?? 0,
      isEstimated: usage['isEstimated'] == true,
      reason: reason,
      timestamp: timestamp,
    );
  }
}

class SupportedProvidersState {
  final List<String> providers;

  const SupportedProvidersState(this.providers);
}

class RemoteChatMessage {
  final String role;
  final String content;

  const RemoteChatMessage({
    required this.role,
    required this.content,
  });
}

class SessionSummary {
  final String id;
  final String title;
  final String provider;
  final int messageCount;
  final DateTime createdAt;

  const SessionSummary({
    required this.id,
    required this.title,
    required this.provider,
    required this.messageCount,
    required this.createdAt,
  });

  factory SessionSummary.fromJson(Map<String, dynamic> data) {
    final createdAtMs = data['createdAt'] is num
        ? (data['createdAt'] as num).toInt()
        : DateTime.now().millisecondsSinceEpoch;

    return SessionSummary(
      id: (data['id'] ?? '').toString(),
      title: (data['title'] ?? data['summary'] ?? 'New Chat').toString(),
      provider: (data['provider'] ?? 'claude').toString(),
      messageCount: (data['messageCount'] as num?)?.toInt() ?? 0,
      createdAt: DateTime.fromMillisecondsSinceEpoch(createdAtMs),
    );
  }
}

class WebSocketService {
  WebSocketChannel? _channel;
  String? _currentSessionId;
  String _selectedProvider = 'claude';
  List<String> _supportedProviders = const ['claude', 'codex'];
  SessionContextState? _currentContextState;
  final StringBuffer _assistantBuffer = StringBuffer();
  bool _assistantBufferHasContent = false;
  bool _isDisposed = false;

  final StreamController<String> _messageController =
      StreamController<String>.broadcast();
  final StreamController<WebSocketConnectionState> _stateController =
      StreamController<WebSocketConnectionState>.broadcast();
  final StreamController<String> _errorController =
      StreamController<String>.broadcast();
  final StreamController<SessionContextState?> _contextController =
      StreamController<SessionContextState?>.broadcast();
  final StreamController<SupportedProvidersState> _supportedProvidersController =
      StreamController<SupportedProvidersState>.broadcast();
  final StreamController<List<SessionSummary>> _sessionListController =
      StreamController<List<SessionSummary>>.broadcast();
  final StreamController<List<RemoteChatMessage>> _historyMessagesController =
      StreamController<List<RemoteChatMessage>>.broadcast();

  Stream<String> get messageStream => _messageController.stream;
  Stream<WebSocketConnectionState> get connectionStateStream => _stateController.stream;
  Stream<String> get errorStream => _errorController.stream;
  Stream<SessionContextState?> get contextStateStream => _contextController.stream;
  Stream<SupportedProvidersState> get supportedProvidersStream =>
      _supportedProvidersController.stream;
  Stream<List<SessionSummary>> get sessionListStream => _sessionListController.stream;
  Stream<List<RemoteChatMessage>> get historyMessagesStream =>
      _historyMessagesController.stream;

  String? get currentSessionId => _currentSessionId;
  String get selectedProvider => _selectedProvider;
  List<String> get supportedProviders => List.unmodifiable(_supportedProviders);
  SessionContextState? get currentContextState => _currentContextState;

  WebSocketConnectionState _currentState = WebSocketConnectionState.disconnected;

  WebSocketConnectionState get currentState => _currentState;

  void _resetConversationState() {
    _currentSessionId = null;
    _currentContextState = null;
    _assistantBuffer.clear();
    _assistantBufferHasContent = false;
    if (!_isDisposed && !_contextController.isClosed) {
      _contextController.add(null);
    }
  }

  List<String> _normalizeSupportedProviders(dynamic rawProviders) {
    if (rawProviders is! List) {
      return const ['claude', 'codex'];
    }

    final providers = rawProviders
        .map((provider) => provider.toString())
        .where((provider) => provider == 'claude' || provider == 'codex')
        .toSet()
        .toList();

    return providers.isEmpty ? const ['claude', 'codex'] : providers;
  }

  void selectProvider(String provider) {
    if (!_supportedProviders.contains(provider)) {
      return;
    }
    _selectedProvider = provider;
  }

  List<RemoteChatMessage> _parseRemoteMessages(dynamic rawMessages) {
    if (rawMessages is! List) {
      return const [];
    }

    return rawMessages
        .whereType<Map>()
        .map((raw) => Map<String, dynamic>.from(raw))
        .map((message) {
          final role = (message['role'] ?? '').toString();
          final content = (message['content'] ?? '').toString();
          return RemoteChatMessage(role: role, content: content);
        })
        .where((message) => message.content.trim().isNotEmpty)
        .toList();
  }

  List<SessionSummary> _parseSessionSummaries(dynamic rawSessions) {
    if (rawSessions is! List) {
      return const [];
    }

    return rawSessions
        .whereType<Map>()
        .map((raw) => SessionSummary.fromJson(Map<String, dynamic>.from(raw)))
        .where((session) => session.id.isNotEmpty)
        .toList();
  }

  void _setCurrentSession({
    String? sessionId,
    String? provider,
    String? title,
    String? reason,
    Map<String, dynamic>? contextUsage,
    Map<String, dynamic>? payload,
  }) {
    if (_isDisposed) {
      return;
    }

    final nextSessionId = sessionId ?? (payload?['sessionId'] ?? payload?['session_id'])?.toString();
    final nextProvider = provider
        ?? payload?['provider']?.toString()
        ?? _currentContextState?.provider
        ?? '';
    final nextTitle = title
        ?? payload?['title']?.toString()
        ?? _currentContextState?.title;
    final payloadTimestamp = payload?['timestamp'];
    if (nextSessionId != null && nextSessionId.isNotEmpty) {
      _currentSessionId = nextSessionId;
    }

    if (contextUsage != null) {
      final data = <String, dynamic>{
        'sessionId': _currentSessionId ?? nextSessionId ?? '',
        'provider': nextProvider ?? '',
        if (nextTitle != null) 'title': nextTitle,
        if (reason != null) 'reason': reason,
        if (payloadTimestamp != null) 'timestamp': payloadTimestamp,
      };
      final state = SessionContextState.fromMessage(data, contextUsage);
      _currentContextState = state;
      _contextController.add(state);
    } else if (nextSessionId != null && _currentContextState != null) {
      _currentContextState = SessionContextState(
        sessionId: nextSessionId,
        provider: nextProvider ?? _currentContextState!.provider,
        title: nextTitle ?? _currentContextState!.title,
        budgetTokens: _currentContextState!.budgetTokens,
        estimatedTokens: _currentContextState!.estimatedTokens,
        remainingTokens: _currentContextState!.remainingTokens,
        overflowTokens: _currentContextState!.overflowTokens,
        usedPercent: _currentContextState!.usedPercent,
        remainingPercent: _currentContextState!.remainingPercent,
        isOverBudget: _currentContextState!.isOverBudget,
        messageCount: _currentContextState!.messageCount,
        isEstimated: _currentContextState!.isEstimated,
        reason: reason ?? _currentContextState!.reason,
        timestamp: DateTime.now(),
      );
      _contextController.add(_currentContextState);
    }
  }

  void _appendAssistantChunk(String chunk, {bool replace = false}) {
    if (_isDisposed) {
      return;
    }

    if (replace) {
      _assistantBuffer
        ..clear()
        ..write(chunk);
      _assistantBufferHasContent = chunk.isNotEmpty;
      return;
    }

    if (chunk.isEmpty) {
      return;
    }

    if (_assistantBufferHasContent) {
      _assistantBuffer.write(chunk);
    } else {
      _assistantBuffer.write(chunk);
      _assistantBufferHasContent = true;
    }
  }

  void _flushAssistantBuffer() {
    if (_isDisposed) {
      return;
    }

    if (!_assistantBufferHasContent) {
      return;
    }

    final text = _assistantBuffer.toString();
    _assistantBuffer.clear();
    _assistantBufferHasContent = false;

    if (text.trim().isNotEmpty) {
      _messageController.add(text);
    }
  }

  void _handleIncomingMessage(String rawMessage) {
    if (_isDisposed) {
      return;
    }

    try {
      final decoded = jsonDecode(rawMessage);
      if (decoded is! Map) {
        if (rawMessage.trim().isNotEmpty) {
          _messageController.add(rawMessage);
        }
        return;
      }

      final data = Map<String, dynamic>.from(decoded as Map);
      final type = data['type']?.toString();
      final sessionPayload = data['session'] is Map
          ? Map<String, dynamic>.from(data['session'] as Map)
          : null;

      Map<String, dynamic>? contextUsage;
      if (data['contextUsage'] is Map) {
        contextUsage = Map<String, dynamic>.from(data['contextUsage'] as Map);
      }

      switch (type) {
        case 'auth_success':
          _supportedProviders = _normalizeSupportedProviders(data['supportedProviders']);
          if (!_supportedProviders.contains(_selectedProvider)) {
            _selectedProvider = _supportedProviders.first;
          }
          _supportedProvidersController.add(SupportedProvidersState(_supportedProviders));
          setState(WebSocketConnectionState.connected);
          requestSessions();
          return;
        case 'session_list':
          _sessionListController.add(_parseSessionSummaries(data['sessions']));
          return;
        case 'auth_failed':
          setState(WebSocketConnectionState.error);
          _errorController.add('Authentication failed. Check your token.');
          return;
        case 'error':
          _flushAssistantBuffer();
          _errorController.add((data['content'] ?? 'Connection error').toString());
          return;
        case 'claude_error':
          _flushAssistantBuffer();
          _errorController.add((data['error'] ?? 'Request failed').toString());
          return;
        case 'message':
          final content = data['content']?.toString();
          if (content != null && content.trim().isNotEmpty) {
            _messageController.add(content);
          }
          return;
        case 'claude_stream':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString(),
            provider: data['provider']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          _appendAssistantChunk(
            data['content']?.toString() ?? '',
            replace: data['replace'] == true,
          );
          if (data['done'] == true) {
            _flushAssistantBuffer();
          }
          return;
        case 'claude_start':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString(),
            provider: data['provider']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          _assistantBuffer.clear();
          _assistantBufferHasContent = false;
          return;
        case 'claude_done':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString() ?? data['providerSessionId']?.toString(),
            provider: data['provider']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          _flushAssistantBuffer();
          return;
        case 'session_created':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString() ?? sessionPayload?['id']?.toString(),
            provider: data['provider']?.toString(),
            title: sessionPayload?['title']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          return;
        case 'session_resumed':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString() ?? sessionPayload?['id']?.toString(),
            provider: data['provider']?.toString(),
            title: sessionPayload?['title']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          _historyMessagesController.add(_parseRemoteMessages(sessionPayload?['messages']));
          return;
        case 'session_id_updated':
          _setCurrentSession(
            sessionId: data['newSessionId']?.toString() ?? data['sessionId']?.toString(),
            provider: data['provider']?.toString(),
            title: data['title']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          return;
        case 'session_running_state':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString(),
            provider: data['provider']?.toString(),
            title: data['title']?.toString(),
            reason: data['reason']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );
          return;
        case 'command_result':
          _setCurrentSession(
            sessionId: data['sessionId']?.toString(),
            provider: data['provider']?.toString(),
            contextUsage: contextUsage,
            payload: data,
          );

          if (data['success'] == true) {
            final payload = data['data'];
            String? text;
            if (payload is String) {
              text = payload;
            } else if (payload is List && payload.isNotEmpty) {
              text = payload.map((item) => item.toString()).join('\n');
            } else if (payload is Map && payload.isNotEmpty) {
              final summary = payload['summary']?.toString();
              final message = payload['message']?.toString();
              text = summary ?? message;
            }

            if (text != null && text.trim().isNotEmpty) {
              _messageController.add(text);
            }
          } else if (data['error'] != null) {
            _errorController.add(data['error'].toString());
          }
          return;
        default:
          final content = data['content']?.toString();
          if (content != null && content.trim().isNotEmpty) {
            _messageController.add(content);
          } else if (rawMessage.trim().isNotEmpty) {
            _messageController.add(rawMessage);
          }
      }
    } catch (_) {
      if (rawMessage.trim().isNotEmpty) {
        _messageController.add(rawMessage);
      }
    }
  }

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
          _handleIncomingMessage(message);
        },
        onError: (error) {
          setState(WebSocketConnectionState.error);
          if (!_isDisposed && !_errorController.isClosed) {
            _errorController.add('Connection error: $error');
          }
          _resetConversationState();
        },
        onDone: () {
          setState(WebSocketConnectionState.disconnected);
          _resetConversationState();
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
      if (!_isDisposed && !_errorController.isClosed) {
        _errorController.add('Failed to connect: $e');
      }
      return false;
    }
  }

  void requestSessions() {
    if (_channel == null || _currentState != WebSocketConnectionState.connected) {
      return;
    }

    _channel!.sink.add(jsonEncode({
      'type': 'session',
      'action': 'list',
      'provider': _selectedProvider,
    }));
  }

  void resumeSession(SessionSummary session) {
    if (_channel == null || _currentState != WebSocketConnectionState.connected) {
      return;
    }

    _selectedProvider = session.provider;
    _currentSessionId = session.id;
    _channel!.sink.add(jsonEncode({
      'type': 'session',
      'action': 'resume',
      'sessionId': session.id,
      'provider': session.provider,
    }));
  }

  void createNewSession({String? provider}) {
    if (_channel == null || _currentState != WebSocketConnectionState.connected) {
      return;
    }

    final nextProvider = provider ?? _selectedProvider;
    if (_supportedProviders.contains(nextProvider)) {
      _selectedProvider = nextProvider;
    }

    _resetConversationState();
    _channel!.sink.add(jsonEncode({
      'type': 'session',
      'action': 'new',
      'provider': _selectedProvider,
    }));
  }

  Future<void> sendMessage(String content, {String? provider}) async {
    if (_channel != null && _currentState == WebSocketConnectionState.connected) {
      if (content.trim().isEmpty) return;

      final nextProvider = provider ?? _selectedProvider;
      if (_supportedProviders.contains(nextProvider)) {
        _selectedProvider = nextProvider;
      }

      final payload = <String, dynamic>{
        'type': 'message',
        'content': content,
        'provider': _selectedProvider,
      };
      if (_currentSessionId != null && _currentSessionId!.isNotEmpty) {
        payload['sessionId'] = _currentSessionId;
      }

      _channel!.sink.add(jsonEncode(payload));
    }
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    setState(WebSocketConnectionState.disconnected);
    _resetConversationState();
  }

  void setState(WebSocketConnectionState state) {
    _currentState = state;
    if (_isDisposed || _stateController.isClosed) {
      return;
    }

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
    _isDisposed = true;
    _channel?.sink.close();
    _messageController.close();
    _stateController.close();
    _errorController.close();
    _contextController.close();
    _supportedProvidersController.close();
    _sessionListController.close();
    _historyMessagesController.close();
  }
}
