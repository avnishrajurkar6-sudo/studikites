import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';
import 'home_screen.dart';
import 'leaderboard_screen.dart';
import 'onboarding_screen.dart';
import 'profile_screen.dart';
import 'welcome_screen.dart';

class RootShell extends StatefulWidget {
  const RootShell({super.key, required this.appState});
  final AppState appState;

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final app = widget.appState;
    if (!app.isAuthenticated) return WelcomeScreen(appState: app);
    if (app.needsOnboarding) return OnboardingScreen(appState: app);

    final pages = [
      HomeScreen(appState: app),
      LeaderboardScreen(appState: app),
      ProfileScreen(appState: app),
    ];

    return Scaffold(
      body: AnimatedSwitcher(
        duration: 320.ms,
        transitionBuilder: (child, anim) => FadeTransition(opacity: anim, child: child),
        child: KeyedSubtree(key: ValueKey(_tab), child: pages[_tab]),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.auto_stories_outlined), selectedIcon: Icon(Icons.auto_stories), label: 'Learn'),
          NavigationDestination(icon: Icon(Icons.leaderboard_outlined), selectedIcon: Icon(Icons.leaderboard), label: 'Leaderboard'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
