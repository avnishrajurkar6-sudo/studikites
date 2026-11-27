import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';
import '../core/api_client.dart';

class LeaderboardScreen extends StatefulWidget {
  const LeaderboardScreen({super.key, required this.appState});
  final AppState appState;

  @override
  State<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends State<LeaderboardScreen> {
  List<LeaderRow> _rows = [];
  bool _loading = true;
  String? _error;
  final bool _suspendedSelf = false;
  bool _hiddenSelf = false;
  final _nameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
    _nameController.text = widget.appState.displayName;
    _hiddenSelf = widget.appState.user['leaderboardHidden'] == true;
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      _rows = await widget.appState.api.leaderboard(limit: 40);
    } catch (e) {
      _error = e is ApiException ? e.message : e.toString();
    } finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _saveName() async {
    final name = _nameController.text.trim();
    if (name.length < 2) { _snack('Name must be at least 2 characters'); return; }
    // Kindness warning shown in dialog; caller confirms.
    try {
      await widget.appState.api.updateLeaderboardProfile(displayName: name, hidden: _hiddenSelf);
      await widget.appState.refreshMe();
      await _load();
      _snack('Saved');
    } catch (e) { _snack(e is ApiException ? e.message : e.toString()); }
  }

  Future<void> _confirmRename() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Keep it kind'),
        content: const Text('Keep your name kind and respectful. Inappropriate names may lead to immediate leaderboard suspension.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok == true) await _saveName();
  }

  Future<void> _toggleHidden(bool hidden) async {
    setState(() => _hiddenSelf = hidden);
    try {
      await widget.appState.api.updateLeaderboardProfile(displayName: _nameController.text.trim().length >= 2 ? _nameController.text.trim() : widget.appState.displayName, hidden: hidden);
      await widget.appState.refreshMe();
      await _load();
    } catch (e) { _snack(e is ApiException ? e.message : e.toString()); }
  }

  Future<void> _suspend(LeaderRow row, bool suspended) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(suspended ? 'Suspend from leaderboard?' : 'Restore rank?'),
        content: Text(suspended
            ? 'Suspend “${row.name}” from the leaderboard? This is leaderboard-only; it doesn’t ban the account.'
            : 'Restore “${row.name}” to the leaderboard?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(suspended ? 'Suspend' : 'Restore')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.appState.api.suspendLeaderboardUser(uid: row.uid, suspended: suspended);
      await _load();
    } catch (e) { _snack(e is ApiException ? e.message : e.toString()); }
  }

  void _snack(String m) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))); }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final myUid = widget.appState.uid ?? '';
    final me = _rows.where((r) => r.uid == myUid).toList();
    final suspended = _suspendedSelf || me.any((r) => r.suspended) || widget.appState.user['leaderboardSuspended'] == true;

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text('Leaderboard', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
            const Text('XP earned from finished lessons. Keep it kind.', style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 16),
            if (suspended)
              Card(color: cs.errorContainer, child: Padding(padding: const EdgeInsets.all(14), child: Text('Your leaderboard access is suspended. Contact support if you think this is a mistake.', style: TextStyle(color: cs.onErrorContainer)))),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Your leaderboard name', style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  TextField(controller: _nameController, maxLength: 40, decoration: const InputDecoration(hintText: 'Display name')),
                  const SizedBox(height: 4),
                  const Text('Keep your name kind and respectful. Inappropriate names may lead to immediate leaderboard suspension.', style: TextStyle(fontSize: 12, color: Colors.grey)),
                  const SizedBox(height: 8),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Hide me from the leaderboard'), value: _hiddenSelf, onChanged: _toggleHidden),
                  FilledButton(onPressed: _confirmRename, child: const Text('Save name')),
                ]),
              ),
            ).animate().fadeIn(),
            const SizedBox(height: 16),
            if (_loading) const Center(child: CircularProgressIndicator())
            else if (_error != null) Center(child: Text(_error!, style: TextStyle(color: cs.error)))
            else if (_rows.isEmpty) const Center(child: Text('No leaderboard data yet.'))
            else ..._rows.asMap().entries.map((e) {
              final r = e.value;
              final isMe = r.uid == myUid;
              return Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: CircleAvatar(backgroundColor: cs.primaryContainer, child: Text('${e.key + 1}')),
                  title: Row(children: [Flexible(child: Text(r.name + (isMe ? ' (you)' : ''), maxLines: 1, overflow: TextOverflow.ellipsis)), if (r.role == 'admin') const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.verified, size: 16))]),
                  subtitle: Text('streak ${r.streak}'),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text('${r.xp} XP', style: const TextStyle(fontWeight: FontWeight.w800)),
                    if (widget.appState.isAdmin && r.role != 'admin') ...[
                      const SizedBox(width: 4),
                      IconButton(icon: Icon(r.suspended ? Icons.check_circle_outline : Icons.block, color: cs.error), tooltip: r.suspended ? 'Restore' : 'Suspend', onPressed: () => _suspend(r, !r.suspended)),
                    ],
                  ]),
                ),
              ).animate().fadeIn(delay: (e.key * 30).ms);
            }),
          ],
        ),
      ),
    );
  }
}
