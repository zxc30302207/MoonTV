#!/usr/bin/env python3
"""Local-only git fixtures: python3 scripts/upstream-sync.test.py"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('upstream_sync', Path(__file__).with_name('upstream-sync.py'))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def git(*args):
    return subprocess.run(['git', *args], check=True, text=True, capture_output=True).stdout.strip()


class UpstreamProposalTests(unittest.TestCase):
    def setUp(self):
        self.previous = os.getcwd()
        self.temp = tempfile.TemporaryDirectory(prefix='moontv-upstream-fixture-')
        os.chdir(self.temp.name)
        git('init', '-b', 'main')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        Path('feature.txt').write_text('original\n')
        git('add', '.')
        git('commit', '-m', 'upstream base')
        self.base = git('rev-parse', 'HEAD')
        git('switch', '-c', 'upstream')

    def tearDown(self):
        os.chdir(self.previous)
        self.temp.cleanup()

    def fork(self, custom=False):
        git('switch', 'main')
        Path('.github').mkdir(exist_ok=True)
        Path('.github/upstream-base.txt').write_text(self.base + '\n')
        Path('custom.txt').write_text('preserve this feature\n')
        if custom:
            Path('feature.txt').write_text('custom line\n')
        git('add', '.')
        git('commit', '-m', 'custom fork')
        self.main = git('rev-parse', 'main')
        git('switch', '-c', 'automation/upstream-test')

    def update(self, protected=False):
        Path('feature.txt').write_text('upstream line\n')
        Path('new.txt').write_text('new upstream feature\n')
        if protected:
            Path('.github/workflows').mkdir(parents=True)
            Path('.github/workflows/untrusted.yml').write_text('untrusted proposal\n')
        git('add', '.')
        git('commit', '-m', 'upstream change')
        return git('rev-parse', 'HEAD')

    def test_clean_diff_keeps_custom_feature_and_never_changes_main(self):
        target = self.update()
        self.fork()
        result = sync.prepare(target)
        self.assertEqual(result['status'], 'clean')
        self.assertEqual(Path('custom.txt').read_text(), 'preserve this feature\n')
        self.assertEqual(Path('feature.txt').read_text(), 'upstream line\n')
        self.assertEqual(Path('.github/upstream-base.txt').read_text().strip(), target)
        self.assertEqual(git('rev-parse', 'main'), self.main)
        self.assertIn('NOT a compatibility', Path('docs/UPSTREAM_SYNC_REPORT.md').read_text())

    def test_conflict_is_report_only_and_keeps_old_base(self):
        target = self.update()
        self.fork(custom=True)
        result = sync.prepare(target)
        self.assertEqual(result['status'], 'manual')
        self.assertEqual(Path('feature.txt').read_text(), 'custom line\n')
        self.assertFalse(Path('new.txt').exists())
        self.assertEqual(Path('.github/upstream-base.txt').read_text().strip(), self.base)
        self.assertEqual(git('diff', '--name-only'), '')
        self.assertEqual(git('diff', '--cached', '--name-only'), '')
        self.assertIn('MANUAL INTEGRATION REQUIRED', Path('docs/UPSTREAM_SYNC_REPORT.md').read_text())
        self.assertEqual(git('rev-parse', 'main'), self.main)

    def test_noop_leaves_checkout_clean(self):
        self.fork()
        self.assertEqual(sync.prepare(self.base)['status'], 'noop')
        self.assertEqual(git('status', '--porcelain'), '')

    def test_upstream_automation_changes_are_report_only(self):
        target = self.update(protected=True)
        self.fork()
        self.assertEqual(sync.prepare(target)['status'], 'manual')
        self.assertFalse(Path('.github/workflows/untrusted.yml').exists())
        self.assertEqual(Path('feature.txt').read_text(), 'original\n')
        self.assertEqual(Path('.github/upstream-base.txt').read_text().strip(), self.base)

    def test_recovery_validates_existing_clean_and_manual_proposals(self):
        target = self.update()
        self.fork()
        sync.prepare(target)
        report = Path('docs/UPSTREAM_SYNC_REPORT.md').read_text()
        self.assertEqual(sync.validate_recovery_report(report, self.base, target, target), 'clean')
        with self.assertRaisesRegex(RuntimeError, 'inconsistent'):
            sync.validate_recovery_report(report, self.base, target, self.base)
        with self.assertRaisesRegex(RuntimeError, 'base/target'):
            sync.validate_recovery_report(report, self.base, '0' * 40, target)
        manual_report = report.replace('**Clean textual application only — NOT a compatibility or security approval.**', '**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**')
        self.assertEqual(sync.validate_recovery_report(manual_report, self.base, target, self.base), 'manual')

    def test_dirty_checkout_and_main_are_rejected(self):
        target = self.update()
        self.fork()
        Path('custom.txt').write_text('uncommitted work')
        with self.assertRaisesRegex(RuntimeError, 'dirty'):
            sync.prepare(target)
        git('restore', 'custom.txt')
        git('switch', 'main')
        with self.assertRaisesRegex(RuntimeError, 'dedicated'):
            sync.prepare(target)


if __name__ == '__main__':
    unittest.main()
