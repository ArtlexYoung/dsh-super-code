#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
case "$(uname -m)" in aarch64|arm64) arch=arm64;; x86_64) arch=x64;; *) printf '%s\n' 'Unsupported Linux architecture' >&2; exit 1;; esac
mkdir -p "$root/builtin/workbench/native/linux-$arch"
cc -Os -s "$root/builtin/workbench/native/linux/window.c" -ldl -o "$root/builtin/workbench/native/linux-$arch/super-code-window"
