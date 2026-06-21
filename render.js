// render.js — headless capture of the Boeing 747 inspection views.
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, 'boeing747');
const OUT = path.join(ROOT, 'renders');
fs.mkdirSync(OUT, { recursive: true });

const onlyViews = process.argv.slice(2); // optional subset

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
           '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR:', m.text()); });
  page.on('pageerror', e => console.log('PAGE-EXC:', e.message));

  const url = `http://127.0.0.1:${port}/index.html`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  let views = await page.evaluate('window.__views');
  if (onlyViews.length) views = views.filter(v => onlyViews.includes(v));

  for (const v of views) {
    await page.evaluate((name) => {
      window.__applyView(name);
      for (let i = 0; i < 3; i++) window.__renderOnce();
    }, v);
    await new Promise(r => setTimeout(r, 120));
    const file = path.join(OUT, v + '.png');
    await page.screenshot({ path: file });
    console.log('saved', file);
  }

  await browser.close();
  server.close();
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
