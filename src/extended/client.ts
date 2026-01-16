import { spawn } from 'child_process';
import path from 'path';

export type ExtendedCliResult =
  | { ok: true; data: unknown; retry_attempts?: number }
  | { ok: false; error: string; status_code?: number; retry_attempts?: number };

const projectRoot = process.cwd();
const extendedCliPath = path.resolve(projectRoot, 'src', 'extended', 'cli.py');
const pythonBin = process.env.EXTENDED_PYTHON_BIN ?? 'python3';

export function runExtendedCli(command: string, payload: Record<string, unknown>): Promise<ExtendedCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [extendedCliPath, command], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      const output = stdout.trim();
      if (!output) {
        reject(new Error(stderr.trim() || 'extended cli returned empty output'));
        return;
      }
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        const message = stderr.trim() || String(error);
        reject(new Error(`failed to parse extended cli output: ${message}`));
      }
    });
    child.stdin.write(JSON.stringify(payload ?? {}));
    child.stdin.end();
  });
}
