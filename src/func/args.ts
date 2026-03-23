export function parseArgs() {
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
