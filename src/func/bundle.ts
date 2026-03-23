import { type BuildContext, type BuildOptions, build, context } from 'esbuild';
import path from 'node:path';


export async function bundleCode(entryPath: string, bundlePath: string, tempDir: string, watchMode: boolean): Promise<BuildContext | undefined> {

    const buildOptions: BuildOptions = {
        entryPoints: [entryPath],
        bundle: true,
        outfile: bundlePath,
        format: 'iife',
        loader: { '.js': 'jsx', '.ts': 'tsx', '.jsx': 'jsx', '.tsx': 'tsx' },
        nodePaths: [path.join(tempDir, 'node_modules')]
    };

    let ctx: BuildContext | undefined;
    if (!watchMode) await build(buildOptions);
    else {
        ctx = await context(buildOptions);
        await ctx.watch();
    }

    return ctx;
}

