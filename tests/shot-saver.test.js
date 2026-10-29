import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { createShotSaverMiddleware } from '../scripts/shot-saver.js';

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}
const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
const dataURL = data => `data:image/png;base64,${data.toString('base64')}`;

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'geet-shots-'));
  const server = createServer(createShotSaverMiddleware({ enabled: true, root: directory, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = ({ method = 'POST', route = '/__shot?dir=m1&name=field', body = dataURL(png), headers = {}, streaming = false } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(origin + route, { method, headers: { ...headers, ...(streaming ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(body) }) } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject); req.end(body);
    });
  return { directory, origin, send };
}

test('accepts a valid same-origin PNG and writes its exact bytes', async t => {
  const { send, origin, directory } = await fixture(t);
  assert.equal((await send({ headers: { Origin: origin } })).status, 200);
  assert.deepEqual(await readFile(path.join(directory, 'm1', 'field.png')), png);
  assert.equal((await send({ route: '/__shot?name=without-origin' })).status, 200);
});

test('disabled endpoint cannot create files', async t => {
  const { send } = await fixture(t, { enabled: false });
  assert.equal((await send()).status, 404);
});

test('rejects non-POST methods and cross-origin or null origins', async t => {
  const { send } = await fixture(t);
  const get = await send({ method: 'GET', body: '' });
  assert.equal(get.status, 405); assert.equal(get.headers.allow, 'POST');
  for (const Origin of ['https://untrusted.example', 'null', 'http://127.0.0.1.evil.example']) {
    assert.equal((await send({ headers: { Origin } })).status, 403);
  }
});

test('rejects traversal, Windows device names, missing and oversized names', async t => {
  const { send } = await fixture(t);
  for (const query of ['dir=..%2Foutside&name=a', 'dir=CON&name=a', 'name=PRN', 'name=', `name=${'a'.repeat(65)}`, 'name=a%2Fb']) {
    assert.equal((await send({ route: `/__shot?${query}` })).status, 400, query);
  }
});

test('caps both declared and streamed body sizes without taking down the server', async t => {
  const { send } = await fixture(t, { maxBytes: 256 });
  assert.equal((await send({ body: 'a'.repeat(257) })).status, 413);
  assert.equal((await send({ body: 'a'.repeat(257), streaming: true })).status, 413);
  assert.equal((await send()).status, 200);
});

test('rejects fake, truncated and corrupt PNG content', async t => {
  const { send } = await fixture(t);
  const corrupt = Buffer.from(png); corrupt[45] ^= 1;
  const fakeImage = Buffer.concat([png.subarray(0, 33), chunk('IDAT', Buffer.from('not compressed')), chunk('IEND', Buffer.alloc(0))]);
  const wrongDimensions = Buffer.concat([png.subarray(0, 33), chunk('IDAT', deflateSync(Buffer.alloc(30))), chunk('IEND', Buffer.alloc(0))]);
  const invalidFilter = Buffer.concat([png.subarray(0, 33), chunk('IDAT', deflateSync(Buffer.from([5, 0, 0, 0, 0]))), chunk('IEND', Buffer.alloc(0))]);
  for (const body of ['plain text', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,!!!!',
    dataURL(png.subarray(0, 8)), dataURL(png.subarray(0, -1)), dataURL(corrupt), dataURL(fakeImage), dataURL(wrongDimensions), dataURL(invalidFilter)]) {
    assert.equal((await send({ body })).status, 400);
  }
});

test('filesystem failures produce a controlled error and server remains available', async t => {
  const { send, directory } = await fixture(t);
  await writeFile(path.join(directory, 'm1'), 'blocks directory creation');
  const failed = await send();
  assert.equal(failed.status, 500);
  assert.equal(failed.body, 'Could not save screenshot');
  assert.equal((await send({ route: '/__shot?dir=other&name=field' })).status, 200);
});
