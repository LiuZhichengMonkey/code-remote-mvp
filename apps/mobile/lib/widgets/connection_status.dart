import 'package:flutter/material.dart';

class ConnectionStatus extends StatelessWidget {
  final bool isConnected;
  final bool isConnecting;

  const ConnectionStatus({
    super.key,
    required this.isConnected,
    required this.isConnecting,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (isConnecting) {
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: theme.colorScheme.primary,
          ),
        ),
      );
    }

    if (isConnected) {
      return Container(
        width: 12,
        height: 12,
        margin: const EdgeInsets.only(right: 16),
        decoration: BoxDecoration(
          color: Colors.green,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Colors.green.withOpacity(0.3),
              blurRadius: 4,
              spreadRadius: 1,
            ),
          ],
        ),
      );
    }

    return Container(
      width: 12,
      height: 12,
      margin: const EdgeInsets.only(right: 16),
      decoration: BoxDecoration(
        color: Colors.grey,
        shape: BoxShape.circle,
      ),
    );
  }
}
