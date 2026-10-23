#!/usr/bin/env python3
"""Prepare an incremental upstream proposal on a clean automation branch.

No network requests, commits, pushes, or PR writes occur here. The caller fetches
upstream and owns publication. Never execute proposed upstream code with tokens.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

BASE_FILE = Path('.github/upstream-base.txt')
REPORT_FILE = Path('docs/UPSTREAM_SYNC_REPORT.md')


def git(*args, check=True):
    return subprocess.run(['git', *args], check=check, text=True, capture_output=True)


def validate_recovery_report(report, expected_base, expected_target, remote_base):
    """Only publish a preserved proposal whose report and base match this update."""
    for value in (expected_base, expected_target, remote_base):
        if not re.fullmatch(r'[0-9a-f]{40}', value):
            raise RuntimeError('Invalid recovery commit identity')
    if f'- Previously integrated: `{expected_base}`\n' not in report or f'- Proposed upstream: `{expected_target}`\n' not in report:
        raise RuntimeError('Existing proposal report does not match the expected base/target')
    manual = '**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**' in report
    clean = '**Clean textual application only — NOT a compatibility or security approval.**' in report
    if manual == clean or remote_base != (expected_base if manual else expected_target):
        raise RuntimeError('Existing proposal base is inconsistent with its report')
    return 'manual' if manual else 'clean'


def prepare(target):
    if git('status', '--porcelain').stdout:
        raise RuntimeError('Refusing to modify a dirty checkout')
    branch = git('branch', '--show-current').stdout.strip()
    if not branch.startswith('automation/upstream-'):
        raise RuntimeError('A dedicated automation/upstream-* branch is required')
    base = BASE_FILE.read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', base):
        raise RuntimeError('Invalid tracked upstream base')
    target = git('rev-parse', '--verify', target + '^{commit}').stdout.strip()
    git('cat-file', '-e', base + '^{commit}')
    if base == target:
        return {'status': 'noop', 'base': base, 'target': target}
    if git('merge-base', '--is-ancestor', base, target, check=False).returncode:
        raise RuntimeError('Upstream history no longer contains the integrated base; manual review required')
    names = git('diff', '--name-only', '-z', base, target).stdout.split('\0')
    names = [name for name in names if name]
    if not names:
        return {'status': 'noop', 'base': base, 'target': target}
    protected = [name for name in names if name.startswith('.github/') or name.startswith('scripts/upstream-sync') or name == str(REPORT_FILE)]
    status = 'manual' if protected else 'clean'
    reason = 'Upstream modifies workflow/sync-control files; automatic application is intentionally disabled.' if protected else ''
    if not protected:
        patch = subprocess.run(['git', 'diff', '--binary', base, target], check=True, capture_output=True).stdout
        result = subprocess.run(['git', 'apply', '--3way', '--index', '-'], input=patch, capture_output=True)
        if result.returncode:
            # The checkout was proven clean and is an isolated proposal branch.
            # This restores tracked content and newly staged files, not user work.
            git('reset', '--hard', 'HEAD')
            if git('status', '--porcelain').stdout:
                raise RuntimeError('Apply cleanup was incomplete; refusing to publish')
            status = 'manual'
            reason = 'Three-way application conflicted. All partial changes were discarded; custom code and the integrated base are unchanged.'
    if status == 'clean':
        BASE_FILE.write_text(target + '\n')
    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.write_text(
        '# Upstream proposal — review required\n\n'
        + ('**MANUAL INTEGRATION REQUIRED — report only; no upstream code applied.**\n\n' if status == 'manual' else '**Clean textual application only — NOT a compatibility or security approval.**\n\n')
        + f'- Previously integrated: `{base}`\n- Proposed upstream: `{target}`\n'
        + f'- Compare: https://github.com/Stardm0/MoonTV/compare/{base}...{target}\n\n'
        + (reason + '\n\n' if reason else '')
        + 'Review every custom feature and security boundary before merging. Never merge this proposal automatically.\n\n'
        + '## Required verification\n\n'
        + 'Run typecheck, strict lint, tests, dependency audit and production build on the exact reviewed commit. Check Vercel preview and desktop/mobile playback.\n\n'
        + 'PRs created by GITHUB_TOKEN may not trigger pull_request CI. A maintainer must manually dispatch the existing CI workflow on this branch (Actions → CI → Run workflow), then verify checks belong to the exact commit. No PAT or extra secret is required.\n\n'
        + '## Changed upstream paths\n\n```json\n'
        + json.dumps(names, ensure_ascii=False, indent=2) + '\n```\n'
    )
    return {'status': status, 'base': base, 'target': target}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', help='Fetched upstream commit or ref')
    parser.add_argument('--output', type=Path, help='JSON result outside the repository')
    parser.add_argument('--recover-report', type=Path, help='Validate an existing remote proposal report only')
    parser.add_argument('--remote-base', type=Path, help='Existing remote proposal base file')
    args = parser.parse_args()
    if args.recover_report:
        if not args.remote_base:
            parser.error('--remote-base is required with --recover-report')
        status = validate_recovery_report(args.recover_report.read_text(), BASE_FILE.read_text().strip(), args.target, args.remote_base.read_text().strip())
        result = {'status': status, 'target': args.target}
    else:
        result = prepare(args.target)
    if args.output:
        args.output.write_text(json.dumps(result))
    print(json.dumps(result))
