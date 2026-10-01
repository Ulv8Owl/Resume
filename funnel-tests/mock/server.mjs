// Локальная копия воронки claude-tour для самопроверки тестов: npm run selftest
// MOCK_BUG=<имя> включает намеренный баг (список — в mock/index.html).
import fs from 'node:fs';
import http from 'node:http';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bug = process.env.MOCK_BUG ?? '';

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && pathname.startsWith('/i/v0/e')) {
      req.resume();
      req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":1}'));
    } else if (pathname === '/claude-tour') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html.replace('<!--BUG-->', `<script>window.__BUG__=${JSON.stringify(bug)}</script>`));
    } else if (pathname === '/mock-solidgate/form.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.SolidgateForm = { ready: true };');
    } else if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end('not found');
    }
  })
  .listen(4173, () => console.log(`mock funnel on http://localhost:4173/claude-tour${bug ? ` (bug: ${bug})` : ''}`));
