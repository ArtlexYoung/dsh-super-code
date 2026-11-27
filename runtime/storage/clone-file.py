#!/usr/bin/env python3
"""Call macOS clonefile without a full-copy fallback or overwriting a target."""
import ctypes
import os
import sys


def main() -> None:
    if sys.platform != 'darwin' or len(sys.argv) != 3:
        raise RuntimeError('Usage on macOS: clone-file.py SOURCE NEW_TARGET')
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    library.clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    library.clonefile.restype = ctypes.c_int
    if library.clonefile(os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2]), 0):
        raise OSError(ctypes.get_errno(), 'native clonefile failed; ordinary copy is not allowed')


if __name__ == '__main__':
    main()
