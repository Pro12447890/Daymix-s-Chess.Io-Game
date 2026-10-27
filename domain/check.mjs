import { promises as dns } from 'node:dns';
import https from 'node:https';

const HOST = 'daymix-chess.strangled.net';
const TARGET = 'pro12447890.github.io';
const GH_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];

function httpsHead(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 12000 }, (res) => resolve(res.statusCode));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

let ok = false;
try {
  const cname = await dns.resolveCname(HOST);
  console.log('CNAME:', cname.join(', '));
  if (cname.some((x) => x.toLowerCase() === TARGET)) ok = true;
} catch (error) {
  console.log('CNAME: нет');
}
try {
  const ips = await dns.resolve4(HOST);
  console.log('A:', ips.join(', '));
  if (ips.some((ip) => GH_IPS.includes(ip))) ok = true;
} catch (error) {
  console.log('A: нет');
}
const status = await httpsHead('https://' + HOST + '/');
console.log('HTTPS:', status === null ? 'не отвечает' : status);
if (!ok) {
  console.log('\nDNS ещё не указывает на GitHub Pages. Внесите CNAME/A в FreeDNS и подождите 5-30 минут.');
  process.exit(1);
}
console.log('\nDNS в порядке. Теперь добавьте domain/CNAME в корень репозитория и включите Enforce HTTPS.');
