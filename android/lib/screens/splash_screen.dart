import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [cs.surface, cs.primary.withValues(alpha: 0.18)],
          ),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(color: cs.primary, borderRadius: BorderRadius.circular(26)),
                child: Center(child: Text('S', style: TextStyle(fontSize: 52, fontWeight: FontWeight.w900, color: cs.onPrimary))),
              ).animate().scale(duration: 650.ms, curve: Curves.easeOutBack).shimmer(delay: 300.ms, duration: 900.ms),
              const SizedBox(height: 20),
              const Text('StudiKitEZ', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)).animate().fadeIn(delay: 200.ms).slideY(begin: 0.3),
              const SizedBox(height: 8),
              Text('Learn calmly.', style: TextStyle(color: cs.onSurfaceVariant)).animate().fadeIn(delay: 350.ms),
              const SizedBox(height: 28),
              const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2.5)).animate().fadeIn(delay: 450.ms),
            ],
          ),
        ),
      ),
    );
  }
}
