import 'package:flutter/material.dart';

import '../core/app_state.dart';
import 'admin_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.appState});
  final AppState appState;

  @override
  Widget build(BuildContext context) {
    final u = appState.user;
    final o = (u['onboarding'] as Map?)?.cast<String, dynamic>() ?? {};
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Text('Profile', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
          const SizedBox(height: 16),
          Card(child: ListTile(leading: const Icon(Icons.person), title: Text(appState.displayName), subtitle: Text(u['email']?.toString() ?? ''))),
          Card(child: ListTile(leading: const Icon(Icons.phone), title: Text(appState.isPhone ? 'Phone sign-in' : 'Google sign-in'), subtitle: Text(u['mobile']?.toString() ?? u['provider']?.toString() ?? ''))),
          Card(child: ListTile(leading: const Icon(Icons.contact_phone_outlined), title: const Text('Contact mobile'), subtitle: Text(u['contactMobile']?.toString() ?? '—'))),
          Card(child: ListTile(leading: const Icon(Icons.school_outlined), title: const Text('Onboarding'), subtitle: Text('done=${o['done'] == true} · batches=${(o['batches'] as List? ?? const []).length}'))),
          if (appState.isAdmin) ...[
            const SizedBox(height: 8),
            FilledButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => AdminScreen(appState: appState))), icon: const Icon(Icons.admin_panel_settings), label: const Text('Admin')),
          ],
          const SizedBox(height: 16),
          OutlinedButton.icon(onPressed: appState.logout, icon: const Icon(Icons.logout), label: const Text('Sign out')),
        ],
      ),
    );
  }
}
