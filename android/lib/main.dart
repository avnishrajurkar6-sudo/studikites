import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';

import 'core/app_services.dart';
import 'core/app_state.dart';
import 'core/theme.dart';
import 'screens/splash_screen.dart';
import 'screens/root_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final appState = AppState();
  await appState.init();

  final appLinks = AppLinks();
  // Cold-start deep link.
  try {
    final initial = await appLinks.getInitialLink();
    if (initial != null) await appState.handleDeepLink(initial);
  } catch (_) {}
  // Runtime deep links.
  appLinks.uriLinkStream.listen((uri) {
    appState.handleDeepLink(uri);
  });

  // Compulsory update check + permissions + home-screen widget + notifications.
  // Permission prompts are requested once the app has a context; non-blocking.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    AppServices.requestAllPermissions();
    AppServices.checkForcedUpdate();
  });

  runApp(StudiKitEZApp(appState: appState));
}

class StudiKitEZApp extends StatelessWidget {
  const StudiKitEZApp({super.key, required this.appState});

  final AppState appState;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: appState,
      builder: (context, _) {
        return MaterialApp(
          title: 'StudiKitEZ',
          debugShowCheckedModeBanner: false,
          theme: SKTheme.light(),
          darkTheme: SKTheme.dark(),
          themeMode: ThemeMode.system,
          home: appState.isLoading ? const SplashScreen() : RootShell(appState: appState),
        );
      },
    );
  }
}
