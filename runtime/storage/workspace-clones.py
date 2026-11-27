"""Independent native copies of Git evidence for a new workspace runner."""
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import stat
import sys


def _identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def _sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.digest()


def _copy_file(source, target):
    before = os.lstat(source)
    if not stat.S_ISREG(before.st_mode):
        raise ValueError('Git evidence source must be an ordinary file')
    expected = _sha(source)
    if _identity(os.lstat(source)) != _identity(before):
        raise RuntimeError('Git evidence changed before cloning')
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    library.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    library.clonefile.restype = ctypes.c_int
    if library.clonefile(os.fsencode(source), os.fsencode(target), 0):
        raise OSError(ctypes.get_errno(), 'Native clone required; ordinary copy is not allowed')
    copied = os.lstat(target)
    if copied.st_nlink != 1 or (copied.st_dev, copied.st_ino) == (before.st_dev, before.st_ino):
        raise RuntimeError('Git evidence is not an independent file')
    if _sha(target) != expected or _identity(os.lstat(source)) != _identity(before):
        raise RuntimeError('Git evidence changed during cloning; preserve partial handoff for recovery')
    return target


def copy_workspace_evidence(source, target):
    if sys.platform != 'darwin':
        raise RuntimeError('This storage policy requires native macOS clones')
    if Path(source).is_symlink() or not Path(source).is_dir():
        raise ValueError('Git evidence root must be an ordinary directory')
    # Preserve the existing runner's symlink and independent-directory behavior.
    return shutil.copytree(source, target, symlinks=True, copy_function=_copy_file)
