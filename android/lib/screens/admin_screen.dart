import 'package:flutter/material.dart';

import '../core/app_state.dart';
import 'leaderboard_screen.dart';

class AdminScreen extends StatelessWidget {
  const AdminScreen({super.key, required this.appState});
  final AppState appState;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Administrator', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            const Text('Suspend or restore leaderboard access for any user. Suspension is leaderboard-only; it does not ban the account. Admins cannot be suspended.'),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LeaderboardScreen(appState: appState))),
              icon: const Icon(Icons.leaderboard),
              label: const Text('Manage leaderboard'),
            ),
          ],
        ),
      ),
    );
  }
}
