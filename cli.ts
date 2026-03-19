#!/usr/bin/env node
import path from 'path';
import fs from 'fs/promises';
import http from 'http';
import { build, context, type BuildOptions, type BuildContext } from 'esbuild';
import os from 'os';
import { builtinModules } from 'module';
import { execSync } from 'child_process';

async function main() {
    const { inputFile, PORT, reactVersion, watchMode } = parseArgs();
    const absoluteInputPath = await ensureFileExists(inputFile);
    const { entryPath, bundlePath, tempDir } = await generateEntryFile(absoluteInputPath, reactVersion);
    console.log('🔍 Scanning for missing dependencies...');
    await resolveDependecies(entryPath, tempDir, reactVersion);
    console.log('⚡ Compiling...');
    const ctx = await bundleCode(entryPath, bundlePath, tempDir, watchMode);
    createWebServer(PORT, bundlePath, watchMode);
    setupCleanup(tempDir, ctx);
}



function parseArgs() {
    const inputFile = process.argv[2];

    if (!inputFile || inputFile.startsWith('-')) {
        console.error('❌ Error: You must specify a file to compile as the first argument.');
        console.log('💡 Usage: react-fly <file.js|jsx|ts|tsx> [-p <port>] [-rv <version>] [-w <boolean>]');
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
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'react-fly-'));
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

async function resolveDependecies(entryPath: string, tempDir: string, reactVersion: string) {
    const missingDeps = await scanDependencies(entryPath);
    if (missingDeps.size > 0) {
        await installDependencies(missingDeps, tempDir, reactVersion);
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

async function installDependencies(missingDeps: Set<string>, tempDir: string, reactVersion: string) {
    const depsObj: Record<string, string> = {};
    const depsArray = Array.from(missingDeps).map(dep => {
        if (dep === 'react' || dep === 'react-dom') {
            depsObj[dep] = reactVersion === 'latest' ? '*' : reactVersion;
            return `${dep}@${reactVersion}`;
        }
        depsObj[dep] = '*';
        return dep;
    });

    console.log(
        `⚛️  Using React version: ${reactVersion}
📦 Installing missing dependencies: ${depsArray.join(', ')}...`);

    await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'react-fly-temp', version: '1.0.0', dependencies: depsObj }, null, 2)
    );

    let installCmd = 'npm install';
    const userAgent = process.env.npm_config_user_agent || '';

    // @ts-ignore
    if (typeof Bun !== 'undefined' || userAgent.includes('bun')) {
        installCmd = 'bun install';
        // @ts-ignore
    } else if (typeof Deno !== 'undefined') {
        installCmd = 'deno install --node-modules-dir';
    } else if (userAgent.includes('pnpm')) {
        installCmd = 'pnpm install';
    } else if (userAgent.includes('yarn')) {
        installCmd = 'yarn install';
    }

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

function createWebServer(PORT: number, bundlePath: string, watchMode: boolean): http.Server {
    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        req.on('error', () => { });

        if (req.url === '/favicon.ico') {
            if (!res.headersSent) res.writeHead(204);
            return res.end();
        }

        if (req.url === '/bundle.js') {
            try {
                const content = await fs.readFile(bundlePath);
                if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(content);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'application/javascript' });
                    res.end('console.error("Bundle not found. Check the terminal for build errors.");');
                } else {
                    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/javascript' });
                    return res.end(`console.error("Error reading bundle: ${err instanceof Error ? err.message : String(err)}");`);
                }
            }
        } else {
            let usesTailwind = false;
            try {
                const bundleCode = await fs.readFile(bundlePath, 'utf8');
                usesTailwind = /["'`][^"'`]*\b(bg-[a-z]+-\d+|text-[a-z]+-\d+|border-[a-z]+-\d+|[pm][trblxy]?-[0-9]+|w-[0-9]+|h-[0-9]+|flex|grid|rounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?)\b[^"'`]*["'`]/.test(bundleCode);
            } catch (err) { }
            const tailwindScript = usesTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : '';

            if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>React On The Fly</title>
            <link rel="icon" href="data:," />
            ${tailwindScript}
          </head>
          <body>
            <div id="root"></div>
            <script src="/bundle.js"></script>
          </body>
        </html>
      `);
        }
    });

    server.listen(PORT, () => {
        console.log(
            `🚀 Ready! Your component is served at: http://localhost:${PORT}\n${watchMode ? '👀 Watching for file changes...' : ''}\nPress Ctrl+C to stop the process.`
        );
    });

    return server;
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