import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.appState});
  final AppState appState;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final o = (appState.user['onboarding'] as Map?)?.cast<String, dynamic>() ?? {};
    final batches = (o['batches'] as List? ?? const []).map((e) => e.toString()).toList();
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Row(children: [
            Expanded(child: Text('Welcome back, ${appState.displayName.isEmpty ? 'learner' : appState.displayName}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)).animate().fadeIn()),
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(color: cs.primary, borderRadius: BorderRadius.circular(14)),
              child: Center(child: Text(appState.displayName.isNotEmpty ? appState.displayName[0].toUpperCase() : 'S', style: TextStyle(color: cs.onPrimary, fontWeight: FontWeight.w800))),
            ),
          ]),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(28),
              gradient: LinearGradient(colors: [cs.primary, cs.primary.withValues(alpha: 0.7)], begin: Alignment.topLeft, end: Alignment.bottomRight),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Your space', style: TextStyle(color: cs.onPrimary.withValues(alpha: 0.9), fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text('${o['dailyMinutes'] ?? 30} min/day · ${o['goal'] ?? 'board'}', style: TextStyle(color: cs.onPrimary, fontSize: 22, fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              Text('${batches.length} batch${batches.length == 1 ? '' : 'es'} selected', style: TextStyle(color: cs.onPrimary.withValues(alpha: 0.9))),
            ]),
          ).animate().fadeIn(delay: 150.ms).slideY(begin: 0.1),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(children: [
                Icon(Icons.auto_awesome, color: cs.primary),
                const SizedBox(width: 12),
                const Expanded(child: Text('Onboarding complete. Keep your kind streak going.')),
              ]),
            ),
          ).animate().fadeIn(delay: 300.ms),
        ],
      ),
    );
  }
}
