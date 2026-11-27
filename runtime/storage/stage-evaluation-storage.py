#!/usr/bin/env python3
"""Stage native session or workspace clones in an explicitly new, unfrozen runner."""
from pathlib import Path
import argparse
import ast
import hashlib
import json
import os
import time

HERE = Path(__file__).resolve().parent


def check_new_root(root: Path) -> None:
    if not root.is_absolute() or root.resolve(strict=True) != root:
        raise ValueError('Use an existing absolute directory without symlink ancestors')
    markers = ['Release.json', 'Prepared.json', 'FrozenAnswer.json', 'Checkpoint.json', 'Sources.json']
    if any(os.path.lexists(root / name) for name in [*markers, 'StoragePolicy.json']):
        raise ValueError('Release already frozen, prepared or staged; original files preserved')
    if any(os.path.lexists(root / name) for name in ['tasks', 'runs', 'runtime-homes']):
        raise ValueError('Runtime lifecycle directories already exist; original files preserved')


def stage(root: Path) -> dict:
    check_new_root(root)
    driver = root / 'driver/runtime-storage.mjs'
    helper = driver.with_name('clone-file.py')
    accounting = root / 'accounting.py'
    if driver.resolve()!=driver or accounting.resolve()!=accounting or not driver.is_file() or not accounting.is_file() or os.path.lexists(helper):
        raise ValueError('New release must contain ordinary driver/runtime-storage.mjs and accounting.py')
    source = accounting.read_text()
    tree = ast.parse(source)
    method = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'collect_sessions'), None)
    if method is None or not any(isinstance(node, ast.Import) and any(alias.name == 'subprocess' for alias in node.names) for node in tree.body):
        raise ValueError('Expected session collector with subprocess import')
    lines = source.splitlines(keepends=True)
    body = ''.join(lines[method.lineno - 1:method.end_lineno])
    before = 'shutil.copyfile(source, output)'
    if body.count(before) != 1:
        raise ValueError('Session collector changed; review the new release before staging')
    replacement = "subprocess.run(['node', str(ROOT / 'driver/runtime-storage.mjs'), 'copy-snapshot', str(source), str(output)], check=True)"
    updated = ''.join(lines[:method.lineno - 1]) + body.replace(before, replacement) + ''.join(lines[method.end_lineno:])
    ast.parse(updated)
    backup = root / 'storage-before-clone-policy'
    backup.mkdir()
    originals = {driver: driver.read_bytes(), accounting: accounting.read_bytes()}
    for path, content in originals.items():
        (backup / path.name).write_bytes(content)
    try:
        for path, content in [(driver, (HERE / 'session-snapshots.mjs').read_bytes()), (accounting, updated.encode()), (helper, (HERE / 'clone-file.py').read_bytes())]:
            temporary = path.with_name(path.name + '.storage-policy.tmp')
            with temporary.open('xb') as output:
                output.write(content); output.flush(); os.fsync(output.fileno())
            os.chmod(temporary, path.stat().st_mode & 0o7777 if path.exists() else 0o644)
            temporary.replace(path)
        receipt = {'at': time.time(), 'policy': 'native-independent-session-clones-v1', 'frozen_runtime_modified': False,
                   'scope': 'New release only; source retained, original attempt paths and SHA preserved.',
                   'source_sha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [*originals, helper]},
                   'backup': str(backup), 'next_gate': 'Run runtime-storage tests, validate full release and freeze new hashes before launching.'}
        (root / 'StoragePolicy.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    except BaseException:
        for path, content in originals.items():
            path.write_bytes(content)
        helper.unlink(missing_ok=True)
        raise
    return receipt


def stage_workspaces(root: Path) -> dict:
    check_new_root(root)
    driver = root / 'runner/runtime/workspaces.py'
    helper = driver.with_name('workspace_clones.py')
    if driver.resolve() != driver or not driver.is_file() or os.path.lexists(helper):
        raise ValueError('Expected a new ordinary runner/runtime/workspaces.py')
    original = driver.read_bytes()
    source = original.decode()
    tree = ast.parse(source)
    method = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'allocate'), None)
    before = "shutil.copytree(archived / '.git', retained, symlinks=True)"
    if method is None:
        raise ValueError('Expected inherited workspace allocator')
    lines = source.splitlines(keepends=True)
    body = ''.join(lines[method.lineno - 1:method.end_lineno])
    if body.count(before) != 1:
        raise ValueError('Workspace handoff changed; review before staging')
    updated = 'from workspace_clones import copy_workspace_evidence\n' + ''.join(lines[:method.lineno - 1]) + body.replace(before, "copy_workspace_evidence(archived / '.git', retained)") + ''.join(lines[method.end_lineno:])
    ast.parse(updated)
    backup = root / 'storage-before-clone-policy'
    backup.mkdir()
    (backup / 'workspaces.py').write_bytes(original)
    try:
        for path, content in [(driver, updated.encode()), (helper, (HERE / 'workspace-clones.py').read_bytes())]:
            temporary = path.with_name(path.name + '.storage-policy.tmp')
            with temporary.open('xb') as output:
                output.write(content); output.flush(); os.fsync(output.fileno())
            os.chmod(temporary, path.stat().st_mode & 0o7777 if path.exists() else 0o644)
            temporary.replace(path)
        receipt = {'at': time.time(), 'policy': 'native-independent-workspace-git-clones-v1', 'frozen_runtime_modified': False,
                   'scope': 'New runner only; original routing identity, complete evidence and task isolation retained.',
                   'source_sha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [driver, helper]},
                   'backup': str(backup), 'next_gate': 'Run workspace handoff tests, validate full runner and freeze new hashes before launching.'}
        (root / 'StoragePolicy.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    except BaseException:
        driver.write_bytes(original)
        helper.unlink(missing_ok=True)
        raise
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument('--new-release', type=Path)
    selection.add_argument('--new-workspace-runner', type=Path)
    args = parser.parse_args()
    result = stage(args.new_release) if args.new_release else stage_workspaces(args.new_workspace_runner)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
