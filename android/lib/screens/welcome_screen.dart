import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';
import 'login_screen.dart';

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key, required this.appState});
  final AppState appState;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [cs.primary.withValues(alpha: 0.22), cs.surface],
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: cs.primary.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
                  child: Text('STUDIKITEZ', style: TextStyle(color: cs.primary, fontWeight: FontWeight.w800, letterSpacing: 1.5, fontSize: 12)),
                ).animate().fadeIn(),
                const SizedBox(height: 28),
                const Text('Learn calmly.\nStudy better.', style: TextStyle(fontSize: 40, fontWeight: FontWeight.w900, height: 1.05))
                    .animate().fadeIn(delay: 150.ms).slideY(begin: 0.2),
                const SizedBox(height: 16),
                Text(
                  'Curated batches, immersive study, a kind leaderboard. Sign in, finish onboarding, and start.',
                  style: TextStyle(fontSize: 16, color: cs.onSurfaceVariant, height: 1.5),
                ).animate().fadeIn(delay: 300.ms),
                const Spacer(),
                FilledButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LoginScreen(appState: appState))),
                  icon: const Icon(Icons.login),
                  label: const Text('Get started'),
                ).animate().fadeIn(delay: 450.ms).slideY(begin: 0.2),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
