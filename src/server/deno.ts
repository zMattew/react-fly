export default async function denoServer(PORT: number, content:Promise<string>) {
    const server = Deno.serve({ port: PORT }, async (req: Request) => {
            const url = new URL(req.url);

            if (url.pathname === '/favicon.ico') {
                return new Response(null, { status: 204 });
            }

            if (url.pathname === '/bundle.js') {
                try {
                    return new Response(await content, {
                        headers: { 'Content-Type': 'application/javascript' }
                    });
                } catch (err: any) {
                    if (err.code === 'ENOENT') {
                        return new Response('console.error("Bundle not found. Check the terminal for build errors.");', {
                            status: 404,
                            headers: { 'Content-Type': 'application/javascript' }
                        });
                    } else {
                        return new Response(`console.error("Error reading bundle: ${err instanceof Error ? err.message : String(err)}");`, {
                            status: 500,
                            headers: { 'Content-Type': 'application/javascript' }
                        });
                    }
                }
            } else {
                let usesTailwind = false;
                try {
                    usesTailwind = /["'`][^"'`]*\b(bg-[a-z]+-\d+|text-[a-z]+-\d+|border-[a-z]+-\d+|[pm][trblxy]?-[0-9]+|w-[0-9]+|h-[0-9]+|flex|grid|rounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?)\b[^"'`]*["'`]/.test(await content);
                } catch (err) { }
                const tailwindScript = usesTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : '';

                return new Response(`
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
              `, {
                    headers: { 'Content-Type': 'text/html' }
                });
            }
    });

    return server
}