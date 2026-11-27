import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_state.dart';
import '../core/api_client.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.appState});
  final AppState appState;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _name = TextEditingController();
  final _contact = TextEditingController();
  final _q = TextEditingController();
  final Set<String> _selectedBatches = {};
  List<Map<String, dynamic>> _batches = [];
  String _goal = 'board';
  String _level = 'beginner';
  int _dailyMinutes = 30;
  bool _reminders = true;
  bool _busy = false;
  bool _loadingBatches = true;
  String? _error;

  String _digits10(String v) {
    final d = v.replaceAll(RegExp(r'\D'), '');
    return d.length >= 10 ? d.substring(d.length - 10) : d;
  }

  @override
  void initState() {
    super.initState();
    final u = widget.appState.user;
    final o = (u['onboarding'] as Map?)?.cast<String, dynamic>() ?? {};
    _name.text = (u['displayName'] ?? u['name'] ?? '').toString().replaceAll(RegExp(r'^\+91\s*'), '');
    final contact = (u['contactMobile'] ?? u['mobile'] ?? o['contactMobile'] ?? '').toString().replaceAll(RegExp(r'\D'), '');
    // Phone-number users CAN fill contact details; prefill sign-in number but leave editable.
    _contact.text = contact.length >= 10 ? contact.substring(contact.length - 10) : contact;
    _selectedBatches.addAll((o['batches'] as List? ?? const []).map((e) => e.toString()));
    _goal = (o['goal'] ?? 'board').toString();
    _level = (o['level'] ?? 'beginner').toString();
    _dailyMinutes = (o['dailyMinutes'] is num ? o['dailyMinutes'] as num : 30).toInt();
    _reminders = o['reminders'] != false;
    _loadBatches();
  }

  Future<void> _loadBatches() async {
    try {
      final list = await widget.appState.api.batches();
      _batches = list.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList();
    } catch (_) { /* keep empty; user can retry */ }
    if (mounted) setState(() => _loadingBatches = false);
  }

  String _batchId(Map<String, dynamic> b) => (b['id'] ?? b['_id'] ?? b['batch'] ?? b['name'] ?? b['title'] ?? '').toString();
  String _batchTitle(Map<String, dynamic> b) => (b['name'] ?? b['title'] ?? b['label'] ?? _batchId(b)).toString();

  Future<void> _finish() async {
    final name = _name.text.trim();
    final contact = _digits10(_contact.text);
    final missing = OnboardingData.missingFields(displayName: name, contactMobile: contact, batches: _selectedBatches.toList());
    if (missing.isNotEmpty) {
      setState(() => _error = 'Please fill in: ${missing.join(', ')}. '
          '${missing.contains('contactMobile') ? 'Phone-number users can enter a 10-digit contact number (it doesn’t change your sign-in number).' : ''}');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await widget.appState.api.saveOnboarding(OnboardingData(
        displayName: name,
        contactMobile: contact,
        batches: _selectedBatches.toList(),
        goal: _goal,
        dailyMinutes: _dailyMinutes.clamp(10, 240),
        level: _level,
        reminders: _reminders,
      ));
      await widget.appState.refreshMe();
    } catch (e) {
      setState(() => _error = e is ApiException ? e.message : e.toString());
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final missing = OnboardingData.missingFields(
      displayName: _name.text,
      contactMobile: _contact.text,
      batches: _selectedBatches.toList(),
    );
    final query = _q.text.trim().toLowerCase();
    final filtered = query.isEmpty ? _batches : _batches.where((b) => _batchTitle(b).toLowerCase().contains(query)).toList();

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text('Finish setting up', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)).animate().fadeIn(),
            const SizedBox(height: 8),
            Text('These fields are compulsory. If anything is missing, we’ll ask you to fill it in before you continue.',
                style: TextStyle(color: cs.onSurfaceVariant)).animate().fadeIn(delay: 100.ms),
            if (missing.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(spacing: 8, children: missing.map((m) => Chip(label: Text('Missing: $m'), backgroundColor: cs.errorContainer)).toList()),
            ],
            const SizedBox(height: 20),
            TextField(controller: _name, decoration: const InputDecoration(labelText: 'What should we call you? *', prefixIcon: Icon(Icons.person_outline))),
            const SizedBox(height: 12),
            TextField(
              controller: _contact,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Contact mobile number (India) *',
                prefixText: '+91 ',
                prefixIcon: const Icon(Icons.phone_outlined),
                helperText: widget.appState.isPhone
                    ? 'Phone-number users can fill this in. It doesn’t change your sign-in number.'
                    : 'Required for your profile. Doesn’t change your sign-in number.',
              ),
            ),
            const SizedBox(height: 20),
            const Text('Your goal', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: ['board', 'school', 'competitive', 'curious'].map((g) => ChoiceChip(
              label: Text(g), selected: _goal == g, onSelected: (_) => setState(() => _goal = g),
            )).toList()),
            const SizedBox(height: 20),
            const Text('Pick your batches *', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            TextField(controller: _q, decoration: const InputDecoration(hintText: 'Search batches…', prefixIcon: Icon(Icons.search)), onChanged: (_) => setState(() {})),
            const SizedBox(height: 8),
            if (_loadingBatches) const Center(child: CircularProgressIndicator())
            else ...filtered.take(200).map((b) {
              final id = _batchId(b);
              if (id.isEmpty) return const SizedBox.shrink();
              return CheckboxListTile(
                value: _selectedBatches.contains(id),
                onChanged: (v) => setState(() { v == true ? _selectedBatches.add(id) : _selectedBatches.remove(id); }),
                title: Text(_batchTitle(b)),
                controlAffinity: ListTileControlAffinity.leading,
              );
            }),
            const SizedBox(height: 20),
            Text('Minutes a day: $_dailyMinutes', style: const TextStyle(fontWeight: FontWeight.w700)),
            Slider(value: _dailyMinutes.toDouble(), min: 10, max: 240, divisions: 23, label: '$_dailyMinutes', onChanged: (v) => setState(() => _dailyMinutes = v.round())),
            DropdownButtonFormField<String>(
              initialValue: _level,
              decoration: const InputDecoration(labelText: 'Where are you now?'),
              items: const [
                DropdownMenuItem(value: 'beginner', child: Text('Just starting')),
                DropdownMenuItem(value: 'revision', child: Text('Revising')),
                DropdownMenuItem(value: 'advanced', child: Text('I know this well')),
              ],
              onChanged: (v) => setState(() => _level = v ?? 'beginner'),
            ),
            SwitchListTile(title: const Text('Daily reminder'), value: _reminders, onChanged: (v) => setState(() => _reminders = v)),
            const SizedBox(height: 16),
            if (_error != null) Text(_error!, style: TextStyle(color: cs.error)),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy ? null : _finish,
              icon: const Icon(Icons.check),
              label: Text(_busy ? 'Saving…' : 'Open my dashboard'),
            ).animate().fadeIn(),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
