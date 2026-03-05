import 'dart:async';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

class QRScannerScreen extends StatefulWidget {
  const QRScannerScreen({super.key});

  @override
  State<QRScannerScreen> createState() => _QRScannerScreenState();
}

class _QRScannerScreenState extends State<QRScannerScreen> {
  final MobileScannerController controller = MobileScannerController();
  bool _isScanning = true;
  String? _scannedCode;

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (!_isScanning) return;

    final barcode = capture.barcodes.first;
    if (barcode.rawValue != null) {
      final code = barcode.rawValue!;
      setState(() {
        _scannedCode = code;
        _isScanning = false;
      });

      // Parse and validate
      final result = _parseQRCode(code);
      if (result != null) {
        // Return to previous screen with connection info
        Navigator.of(context).pop(result);
      } else {
        // Invalid QR code, show error and allow rescan
        _showInvalidQRDialog(code);
      }
    }
  }

  Map<String, String>? _parseQRCode(String code) {
    try {
      // Expected format: code-remote://host:port?token=xxx
      // Or: ws://host:port or wss://host:port with token in separate scan

      if (code.startsWith('code-remote://')) {
        final uri = Uri.parse(code);
        final host = uri.host;
        final port = uri.port;
        final token = uri.queryParameters['token'];

        if (host.isNotEmpty && port > 0 && token != null && token.isNotEmpty) {
          // Determine protocol (ws or wss)
          final protocol = uri.scheme == 'coderemote' ? 'ws' : uri.scheme;
          return {
            'url': '$protocol://$host:$port',
            'token': token,
          };
        }
      }

      // Also support direct ws:// or wss:// URLs
      if (code.startsWith('ws://') || code.startsWith('wss://')) {
        // This might be just the URL, user needs to enter token separately
        return {
          'url': code,
          'token': '', // Will need to enter manually
        };
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  void _showInvalidQRDialog(String code) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('无效的二维码'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('这不是一个有效的 CodeRemote 二维码。'),
            const SizedBox(height: 8),
            Text(
              '扫描内容: $code',
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey.shade400,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
              setState(() {
                _isScanning = true;
                _scannedCode = null;
              });
            },
            child: const Text('重新扫描'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(context).pop(); // Close error dialog
              Navigator.of(context).pop(); // Close scanner
            },
            child: const Text('手动输入'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('扫描二维码'),
        actions: [
          IconButton(
            icon: Icon(_isScanning ? Icons.flash_on : Icons.flash_off),
            onPressed: () {
              controller.toggleTorch();
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          // Scanner
          MobileScanner(
            controller: controller,
            onDetect: _onDetect,
            overlay: Container(
              decoration: ShapeDecoration(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                foregroundDecoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.white.withOpacity(0.3),
                    width: 2,
                  ),
                ),
              ),
            ),
          ),

          // Scanning overlay
          if (_isScanning)
            Positioned.fill(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.3),
                ),
                child: Center(
                  child: Container(
                    width: 250,
                    height: 250,
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: Colors.cyan,
                        width: 2,
                      ),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: CustomPaint(
                      painter: _ScannerCornerPainter(),
                    ),
                  ),
                ),
              ),
            ),

          // Instructions
          if (_isScanning)
            Positioned(
              bottom: 100,
              left: 0,
              right: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: const Text(
                    '将二维码放入框内',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                    ),
                  ),
                ),
              ),
            ),

          // Scanned result
          if (!_isScanning && _scannedCode != null)
            Positioned.fill(
              child: Container(
                color: Colors.black.withOpacity(0.8),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 16),
                      const Text(
                        '正在连接...',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ScannerCornerPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.cyan
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final cornerSize = 30.0;

    // Top left
    canvas.drawPath(
      Path()
        ..moveTo(0, cornerSize)
        ..lineTo(0, 0)
        ..lineTo(cornerSize, 0),
      paint,
    );

    // Top right
    canvas.drawPath(
      Path()
        ..moveTo(size.width - cornerSize, 0)
        ..lineTo(size.width, 0)
        ..lineTo(size.width, cornerSize),
      paint,
    );

    // Bottom left
    canvas.drawPath(
      Path()
        ..moveTo(0, size.height - cornerSize)
        ..lineTo(0, size.height)
        ..lineTo(cornerSize, size.height),
      paint,
    );

    // Bottom right
    canvas.drawPath(
      Path()
        ..moveTo(size.width - cornerSize, size.height)
        ..lineTo(size.width, size.height)
        ..lineTo(size.width, size.height - cornerSize),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
