"""Backport Flutter's simulator log readiness fix into the pinned CI SDK only.

Upstream: flutter/flutter c3ed85ef987759ee54a6bce275490cde2a238dc1
The application and Flutter engine runtime are unchanged.
"""
from pathlib import Path
import sys


def patch(path):
    text = path.read_text(encoding='utf-8')
    replacements = [
        ('final _logReaders = <IOSApp?, DeviceLogReader>{};',
         'final _logReaders = <IOSApp?, _IOSSimulatorLogReader>{};'),
        ('  DeviceLogReader getLogReader({covariant IOSApp? app, bool includePastLogs = false}) {',
         '  _IOSSimulatorLogReader getLogReader({covariant IOSApp? app, bool includePastLogs = false}) {'),
        ('''    if (debuggingOptions.debuggingEnabled) {
      vmServiceDiscovery = ProtocolDiscovery.vmService(
        getLogReader(app: package),''',
         '''    if (debuggingOptions.debuggingEnabled) {
      final _IOSSimulatorLogReader logReader = getLogReader(app: package);
      vmServiceDiscovery = ProtocolDiscovery.vmService(
        logReader,'''),
        ('''        logger: globals.logger,
      );
    }

    // Launch the updated application in the simulator.''',
         '''        logger: globals.logger,
      );
      final timer = Timer(const Duration(seconds: 30), () {
        globals.printError('Waiting for iOS simulator log stream readiness...');
      });
      await logReader._ready.future;
      timer.cancel();
    }

    // Launch the updated application in the simulator.'''),
        ('''  Future<void> _start() async {
    // Unified logging''',
         '''  var _ready = Completer<void>();

  Future<void> _start() async {
    _ready = Completer<void>();
    final Completer<void> ready = _ready;
    // Unified logging'''),
        ('''          .listen(_onUnifiedLoggingLine);
      _deviceProcess?.stderr''',
         '''          .listen((String line) {
            if (!ready.isCompleted) { ready.complete(); }
            _onUnifiedLoggingLine(line);
          });
      _deviceProcess?.stderr'''),
        ('''      _deviceProcess?.exitCode.whenComplete(() {
        if (_linesController.hasListener)''',
         '''      _deviceProcess?.exitCode.whenComplete(() {
        if (!ready.isCompleted) { ready.complete(); }
        if (_linesController.hasListener)'''),
    ]
    for old, new in replacements:
        if text.count(old) != 1:
            raise ValueError('Unexpected Flutter SDK source; refusing partial patch')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    patch(Path(sys.argv[1]))
