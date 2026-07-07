import 'dart:async';
import 'package:flutter/material.dart';
import '../services/websocket_service.dart';
import '../widgets/message_bubble.dart';
import '../widgets/connection_dialog.dart';
import '../widgets/connection_status.dart';
import 'qr_scanner_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late WebSocketService _wsService;
  final List<ChatMessage> _messages = [];
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  bool _isConnected = false;
  bool _isConnecting = false;
  String? _connectionError;
  String _serverUrl = '';
  String _authToken = '';
  List<String> _supportedProviders = const ['claude', 'codex'];
  String _selectedProvider = 'claude';
  List<SessionSummary> _sessionSummaries = const [];
  SessionContextState? _sessionContext;

  StreamSubscription<WebSocketConnectionState>? _connectionSubscription;
  StreamSubscription<String>? _errorSubscription;
  StreamSubscription<String>? _messageSubscription;
  StreamSubscription<SessionContextState?>? _contextSubscription;
  StreamSubscription<SupportedProvidersState>? _providersSubscription;
  StreamSubscription<List<SessionSummary>>? _sessionListSubscription;
  StreamSubscription<List<RemoteChatMessage>>? _historySubscription;

  @override
  void initState() {
    super.initState();
    _wsService = WebSocketService();

    // Listen to connection state changes
    _connectionSubscription = _wsService.connectionStateStream.listen((state) {
      setState(() {
        _isConnected = state == WebSocketConnectionState.connected;
        _isConnecting = state == WebSocketConnectionState.connecting;
        _connectionError = null;
      });
    });

    // Listen to errors
    _errorSubscription = _wsService.errorStream.listen((error) {
      setState(() {
        _connectionError = error;
        _isConnecting = false;
      });
    });

    // Listen to messages
    _messageSubscription = _wsService.messageStream.listen((message) {
      _addMessage(MessageType.received, message);
    });

    _contextSubscription = _wsService.contextStateStream.listen((state) {
      setState(() {
        _sessionContext = state;
      });
    });

    _providersSubscription = _wsService.supportedProvidersStream.listen((state) {
      setState(() {
        _supportedProviders = state.providers;
        if (!_supportedProviders.contains(_selectedProvider)) {
          _selectedProvider = _supportedProviders.first;
        }
      });
    });

    _sessionListSubscription = _wsService.sessionListStream.listen((sessions) {
      setState(() {
        _sessionSummaries = sessions;
      });
    });

    _historySubscription = _wsService.historyMessagesStream.listen((messages) {
      setState(() {
        _messages
          ..clear()
          ..addAll(messages.map((message) => ChatMessage(
                type: message.role == 'user' ? MessageType.sent : MessageType.received,
                content: message.content,
                timestamp: DateTime.now(),
              )));
      });
      _scrollToBottom();
    });

    // Load saved connection info
    _loadConnectionInfo();
  }

  @override
  void dispose() {
    _connectionSubscription?.cancel();
    _errorSubscription?.cancel();
    _messageSubscription?.cancel();
    _contextSubscription?.cancel();
    _providersSubscription?.cancel();
    _sessionListSubscription?.cancel();
    _historySubscription?.cancel();
    _wsService.dispose();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadConnectionInfo() async {
    final saved = await _wsService.loadConnectionInfo();
    if (saved != null) {
      setState(() {
        _serverUrl = saved['url'] ?? '';
        _authToken = saved['token'] ?? '';
      });
    }
  }

  Future<void> _showConnectionDialog() async {
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => ConnectionDialog(
        initialUrl: _serverUrl,
        initialToken: _authToken,
      ),
    );

    if (result != null) {
      setState(() {
        _serverUrl = result['url'] ?? '';
        _authToken = result['token'] ?? '';
      });

      await _connect();
    }
  }

  Future<void> _scanQRCode() async {
    final result = await Navigator.of(context).push<Map<String, String>>(
      MaterialPageRoute(
        builder: (context) => const QRScannerScreen(),
      ),
    );

    if (result != null) {
      setState(() {
        _serverUrl = result['url'] ?? '';
        _authToken = result['token'] ?? '';
      });

      await _connect();
    }
  }

  Future<void> _connect() async {
    if (_serverUrl.isEmpty || _authToken.isEmpty) {
      setState(() {
        _connectionError = 'Please enter server URL and token';
      });
      return;
    }

    setState(() {
      _isConnecting = true;
      _connectionError = null;
    });

    final success = await _wsService.connect(_serverUrl, _authToken);

    if (!success) {
      setState(() {
        _isConnecting = false;
        _connectionError = 'Failed to connect. Please check your settings.';
      });
    }
  }

  void _disconnect() {
    _wsService.disconnect();
    _messages.clear();
    setState(() {
      _sessionContext = null;
      _sessionSummaries = const [];
    });
  }

  void _addMessage(MessageType type, String content) {
    setState(() {
      _messages.add(ChatMessage(
        type: type,
        content: content,
        timestamp: DateTime.now(),
      ));
    });

    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage() async {
    final text = _controller.text.trim();
    if (text.isEmpty || !_isConnected) return;

    _controller.clear();

    _addMessage(MessageType.sent, text);
    await _wsService.sendMessage(text, provider: _selectedProvider);
  }

  void _selectProvider(String provider) {
    if (!_supportedProviders.contains(provider)) {
      return;
    }

    setState(() {
      _selectedProvider = provider;
    });
    _wsService.selectProvider(provider);
    if (_isConnected) {
      _wsService.requestSessions();
    }
  }

  void _startNewSession() {
    if (!_isConnected) {
      return;
    }

    setState(() {
      _messages.clear();
      _sessionContext = null;
    });
    _wsService.createNewSession(provider: _selectedProvider);
    _wsService.requestSessions();
  }

  void _resumeSession(SessionSummary session) {
    Navigator.of(context).pop();
    setState(() {
      _selectedProvider = session.provider;
      _messages.clear();
      _sessionContext = null;
    });
    _wsService.resumeSession(session);
  }

  Future<void> _showHistorySheet() async {
    if (!_isConnected) {
      return;
    }

    _wsService.requestSessions();
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        final theme = Theme.of(context);
        final sessions = _sessionSummaries;

        if (sessions.isEmpty) {
          return SizedBox(
            height: 220,
            child: Center(
              child: Text(
                'No sessions',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          );
        }

        return SafeArea(
          child: ListView.separated(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            itemCount: sessions.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, index) {
              final session = sessions[index];
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  child: Text(_providerShortLabel(session.provider)),
                ),
                title: Text(
                  session.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  '${_providerLabel(session.provider)} | ${session.messageCount} messages',
                ),
                onTap: () => _resumeSession(session),
              );
            },
          ),
        );
      },
    );
  }

  String _providerLabel(String provider) {
    switch (provider) {
      case 'codex':
        return 'Codex';
      case 'claude':
      default:
        return 'Claude';
    }
  }

  String _providerShortLabel(String provider) {
    switch (provider) {
      case 'codex':
        return 'Cx';
      case 'claude':
      default:
        return 'Cl';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('CodeRemote'),
        actions: [
          ConnectionStatus(
            isConnected: _isConnected,
            isConnecting: _isConnecting,
          ),
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: _isConnected ? _showHistorySheet : null,
            tooltip: 'History',
          ),
          IconButton(
            icon: const Icon(Icons.add_comment_outlined),
            onPressed: _isConnected ? _startNewSession : null,
            tooltip: 'New Chat',
          ),
          IconButton(
            icon: const Icon(Icons.qr_code_scanner),
            onPressed: _isConnected ? null : _scanQRCode,
            tooltip: 'Scan QR Code',
          ),
          IconButton(
            icon: Icon(_isConnected ? Icons.link_off : Icons.link),
            onPressed: _isConnected ? _disconnect : _showConnectionDialog,
            tooltip: _isConnected ? 'Disconnect' : 'Connect',
          ),
        ],
      ),
      body: Column(
        children: [
          // Error banner
          if (_connectionError != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              color: theme.colorScheme.errorContainer,
              child: Row(
                children: [
                  Icon(
                    Icons.error_outline,
                    color: theme.colorScheme.onErrorContainer,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _connectionError!,
                      style: TextStyle(
                        color: theme.colorScheme.onErrorContainer,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: Icon(
                      Icons.close,
                      color: theme.colorScheme.onErrorContainer,
                    ),
                    onPressed: () {
                      setState(() {
                        _connectionError = null;
                      });
                    },
                  ),
                ],
              ),
          ),

          if (_sessionContext != null && _isConnected)
            _buildContextBanner(theme),

          // Messages
          Expanded(
            child: _messages.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final message = _messages[index];
                      final showAvatar =
                          index == 0 || _messages[index - 1].type != message.type;
                      return MessageBubble(
                        message: message,
                        showAvatar: showAvatar,
                      );
                    },
                  ),
          ),

          // Input area
          _buildInputArea(theme),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    final theme = Theme.of(context);

    if (!_isConnected && !_isConnecting) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.phone_android_outlined,
                size: 80,
                color: theme.colorScheme.primary.withOpacity(0.3),
              ),
              const SizedBox(height: 24),
              Text(
                'Not Connected',
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Tap the link icon to connect to your CodeRemote server',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: theme.colorScheme.onSurfaceVariant.withOpacity(0.7),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  FilledButton.icon(
                    onPressed: _showConnectionDialog,
                    icon: const Icon(Icons.link),
                    label: const Text('Manual'),
                  ),
                  const SizedBox(width: 12),
                  FilledButton.icon(
                    onPressed: _scanQRCode,
                    icon: const Icon(Icons.qr_code_scanner),
                    label: const Text('Scan QR'),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    }

    return Center(
      child: _isConnecting
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text(
                  'Connecting...',
                  style: TextStyle(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            )
          : Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.chat_bubble_outline,
                  size: 80,
                  color: theme.colorScheme.primary.withOpacity(0.3),
                ),
                const SizedBox(height: 24),
                Text(
                  'Connected',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Send a message to get started',
                  style: TextStyle(
                    color: theme.colorScheme.onSurfaceVariant.withOpacity(0.7),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildInputArea(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_isConnected && _supportedProviders.length > 1)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: _supportedProviders.map((provider) {
                    final selected = provider == _selectedProvider;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(_providerLabel(provider)),
                        selected: selected,
                        onSelected: (_) => _selectProvider(provider),
                      ),
                    );
                  }).toList(),
                ),
              ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      hintStyle: TextStyle(
                        color: theme.colorScheme.onSurfaceVariant.withOpacity(0.5),
                      ),
                      suffixIcon: _controller.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () => _controller.clear(),
                            )
                          : null,
                    ),
                    textCapitalization: TextCapitalization.sentences,
                    onSubmitted: (_) => _sendMessage(),
                    onChanged: (_) => setState(() {}),
                    enabled: _isConnected,
                  ),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: _isConnected && _controller.text.isNotEmpty
                      ? _sendMessage
                      : null,
                  icon: const Icon(Icons.send),
                  label: const Text('Send'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContextBanner(ThemeData theme) {
    final state = _sessionContext;
    if (state == null) {
      return const SizedBox.shrink();
    }

    final progress = state.budgetTokens > 0
        ? (state.usedPercent / 100).clamp(0.0, 1.0)
        : 0.0;
    final accent = state.isOverBudget
        ? theme.colorScheme.error
        : state.remainingPercent < 20
            ? theme.colorScheme.tertiary
            : theme.colorScheme.primary;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            accent.withOpacity(0.18),
            accent.withOpacity(0.06),
          ],
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: accent.withOpacity(0.28),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.memory_rounded,
                size: 18,
                color: accent,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Estimated context ${state.usedPercent.toStringAsFixed(1)}% used | ${state.remainingPercent.toStringAsFixed(1)}% left',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                state.isOverBudget
                    ? 'Over budget'
                    : '~${state.remainingTokens.toString()} tokens left',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: accent,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 8,
              backgroundColor: theme.colorScheme.surfaceContainerHighest.withOpacity(0.45),
              color: accent,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            state.title != null && state.title!.isNotEmpty
                ? '${state.title} | ${state.messageCount} messages | /compact to shrink'
                : '${state.messageCount} messages | /compact to shrink',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

enum MessageType {
  sent,
  received,
}

class ChatMessage {
  final MessageType type;
  final String content;
  final DateTime timestamp;

  ChatMessage({
    required this.type,
    required this.content,
    required this.timestamp,
  });
}
