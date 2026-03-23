import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { writeFile } from "fs/promises"

export async function resolveDependecies(entryPath: string, tempDir: string, reactVersion: string, runtime: string) {
    const missingDeps = await scanDependencies(entryPath);
    if (missingDeps.size > 0) {
        await installDependencies(missingDeps, tempDir, reactVersion, runtime);
    }
}
async function scanDependencies(entryPath: string): Promise<Set<string>> {
    const missingDeps = new Set<string>();

    await build({
        entryPoints: [entryPath],
        bundle: true,
        write: false,
        plugins: [
            {
                name: 'scan',
                setup(build) {
                    build.onResolve({ filter: /^[^.\/]/ }, async (args) => {
                        if (args.pluginData?.isInternal) return null;
                        if (path.isAbsolute(args.path)) return null;
                        if (args.path.startsWith('node:') || builtinModules.includes(args.path)) return { external: true };

                        const result = await build.resolve(args.path, {
                            resolveDir: args.resolveDir,
                            kind: args.kind,
                            pluginData: { isInternal: true },
                        });

                        if (result.errors.length > 0) {
                            const parts = args.path.split('/');
                            const pkgName = args.path.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
                            if (/^(@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(pkgName)) {
                                missingDeps.add(pkgName);
                            }
                            return { external: true };
                        }

                        if (/[\/]node_modules[\/]/.test(result.path)) {
                            return { external: true };
                        }

                        return null;
                    });
                },
            },
        ],
        loader: { '.js': 'jsx', '.ts': 'tsx', '.jsx': 'jsx', '.tsx': 'tsx' },
    });

    return missingDeps;
}

async function installDependencies(missingDeps: Set<string>, tempDir: string, reactVersion: string, runtime: string) {
    const depsObj: Record<string, string> = {};
    const depsArray = Array.from(missingDeps).map(dep => {
        if (dep === 'react' || dep === 'react-dom') {
            depsObj[dep] = reactVersion === 'latest' ? '*' : reactVersion;
            return `${dep}@${reactVersion}`;
        }
        depsObj[dep] = '*';
        return dep;
    });

    await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'react-on-fly-temp', version: '1.0.0', dependencies: depsObj }, null, 2)
    );
    const installCmd = getInstallCommand(runtime)
    console.log(
        `⚛️  Using React version: ${reactVersion}
📦 Installing missing dependencies with ${installCmd.split(' ')[0]}: ${depsArray.join(', ')}...`);
    execSync(installCmd, { cwd: tempDir, stdio: 'inherit' });
}

function getInstallCommand(runtime: string): string {
    const userAgent = process.env.npm_config_user_agent || '';

    if (userAgent.includes('bun')) return 'bun install';
    if (userAgent.includes('deno')) return 'deno install --node-modules-dir';
    if (userAgent.includes('pnpm')) return 'pnpm install';
    if (userAgent.includes('yarn')) return 'yarn install';

    if (runtime === 'bun') return 'bun install';
    if (runtime === 'deno') return 'deno install --node-modules-dir';

    return 'npm install';
}
