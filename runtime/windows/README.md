# Bundled Windows shell

This directory contains separately licensed, unmodified command-line programs.
The plugin's Apache-2.0 license does not replace their licenses. The programs run
as child processes; they are not linked into the plugin.

`manifest.json` pins the decompressed size and SHA-256 of every executable and
DLL. Assets are gzip streams, decoded offline using Node's standard library.
Both x64 and ARM64 Unicode BusyBox builds are included. Bash, GNU grep and their
MSYS libraries are x64 programs; ARM64 Windows runs those through x64 emulation.
No Git executable, development language, compiler or package manager is included.

| Component | Version / origin | License / corresponding source |
|---|---|---|
| GNU Bash | `5.3.015-2`, PortableGit `2.56.0.4` | GPL-3.0-or-later; [GNU Bash 5.3](https://ftp.gnu.org/gnu/bash/bash-5.3.tar.gz), [patches 001–015](https://ftp.gnu.org/gnu/bash/bash-5.3-patches/), [exact MSYS build recipe and patches](https://github.com/git-for-windows/MSYS2-packages/tree/591e6d9e542fb00d8eb03a1376212e111ff525d7/bash) |
| MSYS runtime | `3.6.10-4`, same PortableGit | GPL-3.0-or-later; [COPYING](licenses/MSYS-COPYING.RUNTIME) / [COPYING.LIB](licenses/MSYS-COPYING.LIB); [complete MSYS source package, including build recipe and patches](https://repo.msys2.org/msys/sources/msys2-runtime-3.6.10-4.src.tar.zst) |
| GNU grep | `1~3.0-7`, same PortableGit | GPL-3.0-or-later; [complete source package](https://repo.msys2.org/msys/sources/grep-1~3.0-7.src.tar.zst) |
| GNU libiconv | `1.19-1`, same PortableGit | LGPL-3.0-or-later (the upstream LGPL-2.1-or-later option is exercised at version 3); [complete source package](https://repo.msys2.org/msys/sources/libiconv-1.19-1.src.tar.zst) |
| GNU libintl / gettext | `0.22.5-1`, same PortableGit | LGPL-3.0-or-later (the upstream LGPL-2.1-or-later option is exercised at version 3); [complete source package](https://repo.msys2.org/msys/sources/gettext-0.22.5-1.src.tar.zst) |
| PCRE | `8.45-5`, same PortableGit | [PCRE license](licenses/PCRE-LICENCE.txt); [complete source package](https://repo.msys2.org/msys/sources/pcre-8.45-5.src.tar.zst) |
| BusyBox for Windows | `FRP-6354-g5f09fb446`, Unicode x64 / ARM64 | [GPL-2.0-only](licenses/BusyBox-LICENSE.txt); [complete corresponding source and build configurations included in this package](sources/busybox-w32-FRP-6354-g5f09fb446.tgz) |

Bash also statically uses Readline (`8.3.006-1`, GPL-3.0-or-later) and ncurses
(`6.6-2`, MIT-style license). Their complete source packages and build recipes
are available from the same MSYS source archive:
[Readline](https://repo.msys2.org/msys/sources/readline-8.3.006-1.src.tar.zst),
[ncurses](https://repo.msys2.org/msys/sources/ncurses-6.6-2.src.tar.zst).
See [ncurses's notice](licenses/ncurses-COPYING.txt).

The GNU GPL and LGPL texts are included in `licenses/`. Corresponding source is
available without charge at the URLs above, independently of installing or
running this plugin. The BusyBox source tarball is distributed alongside its
binary assets. It includes `configs/mingw64u_defconfig`,
`configs/mingw64a_defconfig` and the original build scripts; see its `win32/`
documentation. The library DLLs remain separate files and may be replaced with
compatible builds. The plugin's cache checks integrity rather than accepting
silently modified programs; a developer build can update `manifest.json` and
its matching compressed assets. These checks do not restrict rights granted by
the third-party licenses.

Binary provenance, source hashes and assembly instructions are in
[`sources.json`](sources.json). Keep this documentation and the license/source
files with redistributed copies. Before changing a payload, update its matching
sources and notices as well as the manifest; do not relabel an upstream binary
as a newer version.
