import { mkdtemp, writeFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'os';


export async function ensureFileExists(inputFile: string) {
    const absoluteInputPath = path.resolve(process.cwd(), inputFile).replace(/\\/g, '/');
    try {
        await access(absoluteInputPath);
        return absoluteInputPath;
    } catch {
        console.error(`❌ Error: File not found (${absoluteInputPath})`);
        process.exit(1);
    }
}
export async function generateEntryFile(userComponentPath: string, reactVersion: string): Promise<{ bundlePath: string; tempDir: string; entryPath: string; }> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'react-on-fly-'));
    const bundlePath = path.join(tempDir, 'bundle.js');
    const entryPath = path.join(tempDir, 'entry.jsx');
    const parsedVersion = parseInt(reactVersion.split('.')[0], 10);
    const isReact18OrLater = reactVersion === 'latest' || isNaN(parsedVersion) || parsedVersion >= 18;

    const entryCode = `import React from 'react';
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

    await writeFile(entryPath, entryCode);
    return { bundlePath, tempDir, entryPath };
}

