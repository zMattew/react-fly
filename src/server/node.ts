import http from 'http';

export default function nodeServer(PORT: number, content: Promise<string>): http.Server {
    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        req.on('error', () => { });

        if (req.url === '/favicon.ico') {
            if (!res.headersSent) res.writeHead(204);
            return res.end();
        }

        if (req.url === '/bundle.js') {
            try {
                if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(await content);
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
                usesTailwind = /["'`][^"'`]*\b(bg-[a-z]+-\d+|text-[a-z]+-\d+|border-[a-z]+-\d+|[pm][trblxy]?-[0-9]+|w-[0-9]+|h-[0-9]+|flex|grid|rounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?)\b[^"'`]*["'`]/.test(await content);
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

    server.listen(PORT);

    return server;
}