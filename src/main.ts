#!/usr/bin/env node
import { resolveDependecies } from './func/dependency';
import { parseArgs } from './func/args';
import { ensureFileExists, generateEntryFile } from './func/files';
import { bundleCode } from './func/bundle';
import { createWebServer, resolveRuntime, setupCleanup } from './func/server';

async function main() {
    const { inputFile, PORT, reactVersion, watchMode } = parseArgs();
    const absoluteInputPath = await ensureFileExists(inputFile);
    const { entryPath, bundlePath, tempDir } = await generateEntryFile(absoluteInputPath, reactVersion);
    console.log('🔍 Scanning for missing dependencies...');
    const runtime = resolveRuntime()
    await resolveDependecies(entryPath, tempDir, reactVersion, runtime);
    console.log('⚡ Compiling...');
    const ctx = await bundleCode(entryPath, bundlePath, tempDir, watchMode);
    console.log(`⚙️  Starting server using ${runtime} runtime`)
    createWebServer(PORT, bundlePath, watchMode, runtime).
        finally(() => setupCleanup(tempDir, ctx));
}

main().catch(console.error);