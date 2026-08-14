const fs = require('fs');
const http = require('http');
const https = require('https');

function loadEnv() {
  const envFile = '.env';
  if (!fs.existsSync(envFile)) return {};

  const content = fs.readFileSync(envFile, 'utf8');
  const result = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    result[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return result;
}

const env = { ...loadEnv(), ...process.env };
const port = Number(process.env.PORT || env.PORT || 3000);

function getBackendUrls() {
  const raw = process.env.BACKEND_URLS || process.env.BACKEND_URL || env.BACKEND_URLS || env.BACKEND_URL || '';

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((url) => {
      const cleaned = url.replace(/\/+$/, '');
      return cleaned.endsWith('/health') ? cleaned : `${cleaned}/health`;
    });
}

function requestUrl(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;

    const req = client.get(target, (res) => {
      res.resume();
      resolve({
        status: res.statusCode,
        url
      });
    });

    req.on('error', reject);
  });
}

function logTableRow({ status, url, ok, error = '' }) {
  const timestamp = new Date().toISOString();
  const statusText = String(status ?? 'ERR');
  const resultText = ok ? 'SUCCESS' : 'FAILURE';
  const message = error ? ` | ${error}` : '';

  console.log(
    `${timestamp} | ${resultText.padEnd(7, ' ')} | ${statusText.padEnd(3, ' ')} | ${url}${message}`
  );
}

async function runChecks() {
  const urls = getBackendUrls();

  if (!urls.length) {
    console.log('No backend URLs configured. Set BACKEND_URLS or BACKEND_URL in .env');
    return;
  }

  for (const url of urls) {
    try {
      const result = await requestUrl(url);
      logTableRow({
        status: result.status,
        url: result.url,
        ok: result.status >= 200 && result.status < 400
      });
    } catch (error) {
      logTableRow({
        status: 'ERR',
        url,
        ok: false,
        error: error.message
      });
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      uptime: process.uptime(),
      backendUrls: getBackendUrls()
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, message: 'Not found' }));
});

server.listen(port, async () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log('Monitoring URLs:', getBackendUrls());
  await runChecks();
  setInterval(runChecks, 10 * 60 * 1000);
});
