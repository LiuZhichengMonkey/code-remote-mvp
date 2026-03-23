import 'package:flutter/material.dart';
import '../screens/chat_screen.dart';

class MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final bool showAvatar;

  const MessageBubble({
    super.key,
    required this.message,
    this.showAvatar = true,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isSent = message.type == MessageType.sent;

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment:
            isSent ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isSent && showAvatar) ...[
            _buildAvatar(theme),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  isSent ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                Container(
                  constraints: const BoxConstraints(maxWidth: 280),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: isSent
                        ? theme.colorScheme.primaryContainer
                        : theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(16),
                      topRight: const Radius.circular(16),
                      bottomLeft: isSent
                          ? const Radius.circular(16)
                          : const Radius.circular(4),
                      bottomRight: isSent
                          ? const Radius.circular(4)
                          : const Radius.circular(16),
                    ),
                  ),
                  child: Text(
                    message.content,
                    style: TextStyle(
                      color: isSent
                          ? theme.colorScheme.onPrimaryContainer
                          : theme.colorScheme.onSurface,
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _formatTime(message.timestamp),
                  style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant.withOpacity(0.6),
                  ),
                ),
              ],
            ),
          ),
          if (isSent && showAvatar) ...[
            const SizedBox(width: 8),
            _buildAvatar(theme),
          ],
        ],
      ),
    );
  }

  Widget _buildAvatar(ThemeData theme) {
    final isSent = message.type == MessageType.sent;
    return CircleAvatar(
      radius: 16,
      backgroundColor: isSent
          ? theme.colorScheme.primaryContainer
          : theme.colorScheme.tertiaryContainer,
      child: Icon(
        isSent ? Icons.person : Icons.smartphone,
        size: 16,
        color: isSent
            ? theme.colorScheme.onPrimaryContainer
            : theme.colorScheme.onTertiaryContainer,
      ),
    );
  }

  String _formatTime(DateTime dateTime) {
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.inMinutes < 1) {
      return 'Just now';
    } else if (difference.inHours < 1) {
      return '${difference.inMinutes}m ago';
    } else if (difference.inDays < 1) {
      return '${difference.inHours}h ago';
    } else {
      return '${dateTime.day}/${dateTime.month} ${dateTime.hour}:${dateTime.minute.toString().padLeft(2, '0')}';
    }
  }
}
