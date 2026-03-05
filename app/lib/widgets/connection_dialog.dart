import 'package:flutter/material.dart';

class ConnectionDialog extends StatefulWidget {
  final String initialUrl;
  final String initialToken;

  const ConnectionDialog({
    super.key,
    this.initialUrl = '',
    this.initialToken = '',
  });

  @override
  State<ConnectionDialog> createState() => _ConnectionDialogState();
}

class _ConnectionDialogState extends State<ConnectionDialog> {
  late final TextEditingController _urlController;
  late final TextEditingController _tokenController;
  bool _obscureToken = true;
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.initialUrl);
    _tokenController = TextEditingController(text: widget.initialToken);
  }

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  void _handleConnect() {
    if (_formKey.currentState!.validate()) {
      Navigator.of(context).pop({
        'url': _urlController.text.trim(),
        'token': _tokenController.text.trim(),
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: const Text('Connect to Server'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              controller: _urlController,
              decoration: const InputDecoration(
                labelText: 'Server URL',
                hintText: 'ws://localhost:8080',
                prefixIcon: Icon(Icons.link),
                helperText: 'e.g., ws://your-domain.com or wss://your-tunnel.com',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Please enter a server URL';
                }
                return null;
              },
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _tokenController,
              decoration: InputDecoration(
                labelText: 'Auth Token',
                hintText: 'Enter your token',
                prefixIcon: const Icon(Icons.key),
                suffixIcon: IconButton(
                  icon: Icon(_obscureToken ? Icons.visibility_off : Icons.visibility),
                  onPressed: () {
                    setState(() {
                      _obscureToken = !_obscureToken;
                    });
                  },
                ),
              ),
              obscureText: _obscureToken,
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Please enter your token';
                }
                return null;
              },
              onFieldSubmitted: (_) => _handleConnect(),
            ),
            const SizedBox(height: 16),
            Card(
              color: theme.colorScheme.secondaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Scan the QR code on your computer to auto-fill these fields',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.onSecondaryContainer,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _handleConnect,
          child: const Text('Connect'),
        ),
      ],
    );
  }
}
