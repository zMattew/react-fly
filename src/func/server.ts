import type { BuildContext } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';


export function resolveRuntime() {
    if (typeof Bun !== 'undefined') return 'bun';
    if (typeof Deno !== 'undefined') return 'deno';
    return 'node';
}export async function createWebServer(PORT: number, bundlePath: string, watchMode: boolean, runtime: string = 'node') {
    const content = readFile(bundlePath, 'utf8');
    let server;
    switch (runtime) {
        case 'bun': {
            const { default: bunServer } = await import('../server/bun');
            server = bunServer(PORT, watchMode, content);
            break;
        }
        case 'deno': {
            const { default: denoServer } = await import('../server/deno');
            server = denoServer(PORT, watchMode, content);
            break;
        }
        case 'node':
        default: {
            const { default: nodeServer } = await import('../server/node');
            server = nodeServer(PORT, watchMode, content);
            break;
        }
    }
    console.log(`🚀 Ready! Your component is served at: http://localhost:${PORT}\n${watchMode ? '👀 Watching for file changes...' : ''}\nPress Ctrl+C to stop the process.`);
    return server;
}

export function setupCleanup(tempDir: string, ctx?: BuildContext) {
    process.on('SIGINT', async () => {
        console.log('\nShutting down the server and cleaning up temporary files...');
        if (ctx) {
            await ctx.dispose();
        }
        await rm(tempDir, { recursive: true, force: true });
        process.exit(0);
    });
}

