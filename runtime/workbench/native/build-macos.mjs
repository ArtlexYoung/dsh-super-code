import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url), source = new URL('builtin/workbench/native/darwin/window.m', root);
const app = new URL('builtin/workbench/native/darwin/Super Code.app/', root), executable = new URL('Contents/MacOS/Super Code', app);
await mkdir(new URL('Contents/MacOS/', app), { recursive: true });
execFileSync('/usr/bin/clang', ['-Os', '-fobjc-arc', '-mmacosx-version-min=11.0', '-arch', 'arm64', '-arch', 'x86_64', fileURLToPath(source), '-framework', 'Cocoa', '-framework', 'WebKit', '-o', fileURLToPath(executable)], { stdio: 'inherit' });
execFileSync('/usr/bin/strip', ['-x', fileURLToPath(executable)]);
await writeFile(new URL('Contents/Info.plist', app), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Super Code</string><key>CFBundleIdentifier</key><string>com.artlex.dsh-super-code.window</string><key>CFBundleName</key><string>Super Code</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>11.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', fileURLToPath(app)], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', fileURLToPath(app)], { stdio: 'inherit' });
