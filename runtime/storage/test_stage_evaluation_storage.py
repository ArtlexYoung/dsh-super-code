"""Stage only fresh release templates; never rewrite frozen executor files."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('stage_storage', HERE / 'stage-evaluation-storage.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

ACCOUNTING = '''from pathlib import Path
import shutil
import subprocess
ROOT = Path(__file__).resolve().parent
def collect_sessions(task_root, final):
    source = task_root / 'session.zstd'
    output = final / 'session.zstd'
    shutil.copyfile(source, output)
    return output
'''

WORKSPACES = '''from pathlib import Path
import hashlib
import json
import shutil
def allocate(root, repo, run):
    area = root / 'inherited-projects'
    area.mkdir(exist_ok=True)
    name = hashlib.sha256(repo.encode()).hexdigest()[:24]
    workspace, receipt = area / name, area / (name + '.json')
    keep_git = False
    if workspace.exists():
        prior = json.loads(receipt.read_text())
        archived = Path(prior['run']) / 'inherited-workspace-final'
        assert not archived.exists()
        keep_git = (workspace / '.git').is_dir()
        shutil.move(str(workspace), str(archived))
        (Path(prior['run']) / 'workspace-handoff.json').write_text('{}')
    workspace.mkdir()
    if keep_git:
        retained = workspace / '.git-evidence'
        shutil.copytree(archived / '.git', retained, symlinks=True)
        shutil.move(str(archived / '.git'), str(workspace / '.git'))
        retained.rename(archived / '.git')
        for child in (workspace / '.git').iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
    receipt.write_text(json.dumps({'repo': repo, 'run': str(run)}))
    return workspace
'''


class StagingTests(unittest.TestCase):
    def fixture(self, root: Path) -> None:
        (root / 'driver').mkdir()
        (root / 'driver/runtime-storage.mjs').write_text('export const oldTemplate = true\n')
        (root / 'accounting.py').write_text(ACCOUNTING)

    def test_new_template_covers_archive_and_final_collection(self):
        with tempfile.TemporaryDirectory(prefix='dsh-storage-staging-') as name:
            root = Path(name).resolve()
            self.fixture(root)
            receipt = MODULE.stage(root)
            self.assertFalse(receipt['frozen_runtime_modified'])
            for relative, digest in receipt['source_sha256'].items():
                self.assertEqual(hashlib.sha256((root / relative).read_bytes()).hexdigest(), digest)
            spec = importlib.util.spec_from_file_location('new_accounting', root / 'accounting.py')
            accounting = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(accounting)
            source, final = root / 'old-attempt', root / 'new-final'
            source.mkdir(); final.mkdir()
            original = b'preserve failure and answer evidence' * 1000
            (source / 'session.zstd').write_bytes(original)
            copied = accounting.collect_sessions(source, final)
            self.assertEqual(copied.read_bytes(), original)
            self.assertNotEqual(copied.stat().st_ino, (source / 'session.zstd').stat().st_ino)
            (source / 'session.zstd').write_bytes(b'later change')
            self.assertEqual(copied.read_bytes(), original)
            self.assertEqual((root / 'storage-before-clone-policy/accounting.py').read_text(), ACCOUNTING)
            with self.assertRaisesRegex(ValueError, 'frozen, prepared or staged'):
                MODULE.stage(root)

    def test_frozen_prepared_or_started_releases_are_unchanged(self):
        for marker in ['Release.json', 'Prepared.json', 'Sources.json', 'FrozenAnswer.json', 'Checkpoint.json', 'StoragePolicy.json', 'tasks', 'runs', 'runtime-homes']:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory(prefix='dsh-storage-frozen-') as name:
                root = Path(name).resolve()
                self.fixture(root)
                (root / marker).write_text('{}')
                before = {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                with self.assertRaises(ValueError):
                    MODULE.stage(root)
                self.assertEqual(before, {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_changed_collector_requires_review_before_any_write(self):
        with tempfile.TemporaryDirectory(prefix='dsh-storage-review-') as name:
            root = Path(name).resolve()
            self.fixture(root)
            (root / 'accounting.py').write_text(ACCOUNTING.replace('shutil.copyfile', 'shutil.copy2'))
            with self.assertRaisesRegex(ValueError, 'collector changed'):
                MODULE.stage(root)
            self.assertFalse((root / 'storage-before-clone-policy').exists())

    def test_workspace_handoff_keeps_identity_and_independent_git_evidence(self):
        with tempfile.TemporaryDirectory(prefix='dsh-workspace-staging-') as name:
            root = Path(name).resolve()
            runtime = root / 'runner/runtime'; runtime.mkdir(parents=True)
            (runtime / 'workspaces.py').write_text(WORKSPACES)
            MODULE.stage_workspaces(root)
            spec = importlib.util.spec_from_file_location('new_workspace_allocator', runtime / 'workspaces.py')
            allocator = importlib.util.module_from_spec(spec)
            sys.path.insert(0, str(runtime))
            try:
                spec.loader.exec_module(allocator)
                first, second = root / 'run-a', root / 'run-b'
                first.mkdir(); second.mkdir()
                workspace = allocator.allocate(root, 'owner/repo', first)
                (workspace / '.git/objects').mkdir(parents=True)
                payload = os.urandom(200000)
                (workspace / '.git/objects/payload').write_bytes(payload)
                original_file_inode = (workspace / '.git/objects/payload').stat().st_ino
                (workspace / '.git/alias').symlink_to('objects/payload')
                inode = (workspace / '.git').stat().st_ino
                self.assertEqual(allocator.allocate(root, 'owner/repo', second), workspace)
                evidence = first / 'inherited-workspace-final/.git'
                self.assertEqual((evidence / 'objects/payload').read_bytes(), payload)
                self.assertNotEqual((evidence / 'objects/payload').stat().st_ino, original_file_inode)
                self.assertTrue((evidence / 'alias').is_symlink())
                self.assertEqual((workspace / '.git').stat().st_ino, inode)
                self.assertEqual(list((workspace / '.git').iterdir()), [])
                self.assertTrue((first / 'workspace-handoff.json').exists())
                self.assertNotEqual(allocator.allocate(root, 'owner/other', second), workspace)
                self.assertEqual(WORKSPACES, (root / 'storage-before-clone-policy/workspaces.py').read_text())
                copied = root / 'independent-evidence'
                allocator.copy_workspace_evidence(evidence, copied)
                (copied / 'objects/payload').write_bytes(b'independent change')
                self.assertEqual((evidence / 'objects/payload').read_bytes(), payload)
            finally:
                sys.path.pop(0)
                sys.modules.pop('workspace_clones', None)

    def test_workspace_frozen_or_changed_allocator_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix='dsh-workspace-frozen-') as name:
            root = Path(name).resolve()
            runtime = root / 'runner/runtime'; runtime.mkdir(parents=True)
            driver = runtime / 'workspaces.py'; driver.write_text('def allocate():\n    return 1\n')
            with self.assertRaisesRegex(ValueError, 'handoff changed'):
                MODULE.stage_workspaces(root)
            self.assertEqual(driver.read_text(), 'def allocate():\n    return 1\n')
            self.assertFalse((root / 'storage-before-clone-policy').exists())
            (root / 'Sources.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'frozen, prepared or staged'):
                MODULE.stage_workspaces(root)


if __name__ == '__main__':
    unittest.main()
