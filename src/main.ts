#!/usr/bin/env node
import path from 'path';
import fs from 'node:fs/promises';
import { build, context, type BuildOptions, type BuildContext } from 'esbuild';
import os from 'os';
import { builtinModules } from 'module';
import { execSync } from 'child_process';

async function main() {
    const runtime = resolveRuntime()
    const { inputFile, PORT, reactVersion, watchMode } = parseArgs();
    const absoluteInputPath = await ensureFileExists(inputFile);
    const { entryPath, bundlePath, tempDir } = await generateEntryFile(absoluteInputPath, reactVersion);
    console.log('🔍 Scanning for missing dependencies...');
    await resolveDependecies(entryPath, tempDir, reactVersion, runtime);
    console.log('⚡ Compiling...');
    const ctx = await bundleCode(entryPath, bundlePath, tempDir, watchMode);
    console.log(`⚙️  Starting server using ${runtime} runtime`)
    createWebServer(PORT, bundlePath, watchMode, runtime).
        finally(() => setupCleanup(tempDir, ctx));
}

function resolveRuntime() {
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof Deno !== 'undefined') return 'deno';
    return 'node';
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

function parseArgs() {
    const inputFile = process.argv[2];

    if (!inputFile || inputFile.startsWith('-')) {
        console.error('❌ Error: You must specify a file to compile as the first argument.');
        console.log('💡 Usage: react-on-fly <file.js|jsx|ts|tsx> [-p <port>] [-rv <version>] [-w <boolean>]');
        process.exit(1);
    }

    let PORT = 3000;
    let reactVersion = 'latest';
    let watchMode = false;

    const args = process.argv.slice(3);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '-p':
                const parsedPort = parseInt(args[++i], 10);
                if (!isNaN(parsedPort) && parsedPort > 0) PORT = parsedPort;
                break;
            case '-rv':
                reactVersion = args[++i] || 'latest';
                break;
            case '-w':
                const nextArg = args[i + 1];
                if (nextArg === 'true' || nextArg === 'false') {
                    watchMode = nextArg === 'true';
                    i++;
                } else watchMode = true;
                break;
        }
    }

    return { inputFile, PORT, reactVersion, watchMode };
}

async function ensureFileExists(inputFile: string) {
    const absoluteInputPath = path.resolve(process.cwd(), inputFile).replace(/\\/g, '/');
    try {
        await fs.access(absoluteInputPath);
        return absoluteInputPath
    } catch {
        console.error(`❌ Error: File not found (${absoluteInputPath})`);
        process.exit(1);
    }
}

async function generateEntryFile(userComponentPath: string, reactVersion: string): Promise<{ bundlePath: string, tempDir: string, entryPath: string }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'react-on-fly-'));
    const bundlePath = path.join(tempDir, 'bundle.js');
    const entryPath = path.join(tempDir, 'entry.jsx');
    const parsedVersion = parseInt(reactVersion.split('.')[0], 10);
    const isReact18OrLater = reactVersion === 'latest' || isNaN(parsedVersion) || parsedVersion >= 18;

    const entryCode =
        `import React from 'react';
${isReact18OrLater ?
            `import { createRoot } from 'react-dom/client';
import UserApp from '${userComponentPath}';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(React.createElement(UserApp));` :

            `import ReactDOM from 'react-dom';
import UserApp from '${userComponentPath}';

const container = document.getElementById('root');
ReactDOM.render(React.createElement(UserApp), container);
`}`;

    await fs.writeFile(entryPath, entryCode);
    return { bundlePath, tempDir, entryPath };
}

async function resolveDependecies(entryPath: string, tempDir: string, reactVersion: string, runtime: string) {
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
                    build.onResolve({ filter: /^[^.\/]/ }, async args => {
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

    await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'react-on-fly-temp', version: '1.0.0', dependencies: depsObj }, null, 2)
    );
    const installCmd = getInstallCommand(runtime)
    console.log(
        `⚛️  Using React version: ${reactVersion}
📦 Installing missing dependencies with ${installCmd.split(' ')[0]}: ${depsArray.join(', ')}...`);
    execSync(installCmd, { cwd: tempDir, stdio: 'inherit' });
}

async function bundleCode(entryPath: string, bundlePath: string, tempDir: string, watchMode: boolean): Promise<BuildContext | undefined> {

    const buildOptions: BuildOptions = {
        entryPoints: [entryPath],
        bundle: true,
        outfile: bundlePath,
        format: 'iife',
        loader: { '.js': 'jsx', '.ts': 'tsx', '.jsx': 'jsx', '.tsx': 'tsx' },
        nodePaths: [path.join(tempDir, 'node_modules')]
    };

    let ctx: BuildContext | undefined;
    if (!watchMode) await build(buildOptions)
    else {
        ctx = await context(buildOptions);
        await ctx.watch();
    }

    return ctx;
}

async function createWebServer(PORT: number, bundlePath: string, watchMode: boolean, runtime: string = 'node') {
    const content = fs.readFile(bundlePath, 'utf8');
    let server
    switch (runtime) {
        case 'bun': {
            const { default: bunServer } = await import('./server/bun');
            server = bunServer(PORT, watchMode, content);
            break;
        }
        case 'deno': {
            const { default: denoServer } = await import('./server/deno');
            server = denoServer(PORT, watchMode, content);
            break;
        }
        case 'node':
        default: {
            const { default: nodeServer } = await import('./server/node');
            server = nodeServer(PORT, watchMode, content);
            break;
        }
    }
    console.log(`🚀 Ready! Your component is served at: http://localhost:${PORT}\n${watchMode ? '👀 Watching for file changes...' : ''}\nPress Ctrl+C to stop the process.`);
    return server
}

function setupCleanup(tempDir: string, ctx?: BuildContext) {
    process.on('SIGINT', async () => {
        console.log('\nShutting down the server and cleaning up temporary files...');
        if (ctx) {
            await ctx.dispose();
        }
        await fs.rm(tempDir, { recursive: true, force: true });
        process.exit(0);
    });
}



main().catch(console.error);