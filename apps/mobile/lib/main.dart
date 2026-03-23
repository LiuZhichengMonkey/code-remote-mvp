import 'package:flutter/material.dart';
import 'screens/chat_screen.dart';

void main() {
  runApp(const CodeRemoteApp());
}

class CodeRemoteApp extends StatelessWidget {
  const CodeRemoteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CodeRemote',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.cyan),
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      home: const ChatScreen(),
    );
  }
}
