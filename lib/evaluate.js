#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { evaluateSuperCodeBatch } from './core/evaluation.js';
/** Offline acceptance only: this command never starts a model or rewrites evidence. */
async function main() {
    const [manifestPath, measurementsPath, ...extra] = process.argv.slice(2);
    if (!manifestPath || !measurementsPath || extra.length > 0)
        throw new Error('Usage: super-code-eval manifest.json measurements.jsonl');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    evaluateSuperCodeBatch(manifest, []); // Validate the manifest before reading measurements.
    const rows = [];
    const input = createReadStream(measurementsPath, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (line.trim() === '')
                continue;
            rows.push(JSON.parse(line));
            if (rows.length > manifest.cases.length * 2)
                throw new Error('Too many measurements: one baseline and one candidate per case are allowed');
        }
    }
    finally {
        lines.close();
        input.destroy();
    }
    const result = evaluateSuperCodeBatch(manifest, rows);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.accepted ? 0 : 1;
}
try {
    await main();
}
catch (error) {
    process.stderr.write(JSON.stringify({ status: 'invalid', accepted: false, error: error instanceof Error ? error.message : 'Evaluation failed' }) + '\n');
    process.exitCode = 2;
}
//# sourceMappingURL=evaluate.js.map