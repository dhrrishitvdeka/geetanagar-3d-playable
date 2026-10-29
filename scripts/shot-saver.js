import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

export const MAX_SHOT_BYTES = 16 * 1024 * 1024;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const safeName = value => NAME.test(value || '') && !RESERVED.test(value);
const inflatePNG = promisify(inflate);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Canvas captures must be PNG data URLs with complete, checksummed PNG chunks.
async function decodePNG(body) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.toString('utf8'));
  if (!match || match[1].length % 4 !== 0) return null;
  const png = Buffer.from(match[1], 'base64');
  if (png.toString('base64') !== match[1] || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let offset = 8, header = false, image = false;
  const compressed = [];
  let scanlines = [], decodedSize = 0;
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset), end = offset + 12 + size;
    if (end > png.length) return null;
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) return null;
    if (!header && type !== 'IHDR') return null;
    if (type === 'IHDR') {
      if (header || size !== 13) return null;
      const width = png.readUInt32BE(offset + 8), height = png.readUInt32BE(offset + 12);
      const depth = png[offset + 16], color = png[offset + 17];
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 8192 || height > 8192 || width * height > 32 * 1024 * 1024
        || !depths[color]?.includes(depth) || png[offset + 18] !== 0 || png[offset + 19] !== 0 || png[offset + 20] > 1) return null;
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
      const passes = png[offset + 20] ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
      scanlines = passes.map(([x, y, dx, dy]) => {
        const columns = Math.max(0, Math.ceil((width - x) / dx));
        const rows = columns ? Math.max(0, Math.ceil((height - y) / dy)) : 0;
        const stride = 1 + Math.ceil(columns * channels * depth / 8);
        decodedSize += rows * stride;
        return { rows, stride };
      });
      if (decodedSize > 128 * 1024 * 1024) return null;
      header = true;
    }
    if (type === 'IDAT' && size > 0) { image = true; compressed.push(png.subarray(offset + 8, end - 4)); }
    if (type === 'IEND') {
      if (size !== 0 || !image || end !== png.length) return null;
      try {
        const pixels = await inflatePNG(Buffer.concat(compressed), { maxOutputLength: decodedSize });
        if (pixels.length !== decodedSize) return null;
        let row = 0;
        for (const { rows, stride } of scanlines) for (let i = 0; i < rows; i++, row += stride) if (pixels[row] > 4) return null;
      } catch { return null; }
      return png;
    }
    offset = end;
  }
  return null;
}

export function createShotSaverMiddleware({
  enabled = process.env.GEET_SCREENSHOTS === '1',
  root = path.resolve('screenshots'),
  maxBytes = MAX_SHOT_BYTES,
} = {}) {
  return async (req, res) => {
    const reply = (status, message) => {
      if (!res.destroyed && !res.writableEnded) {
        res.statusCode = status;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(message);
      }
    };
    if (!enabled) { reply(404, 'Not found'); return; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); reply(405, 'POST required'); return; }
    try {
      const expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin;
      if (req.headers.origin !== undefined && req.headers.origin !== expected) { reply(403, 'Origin rejected'); return; }
      const url = new URL(req.url, expected);
      const dir = url.searchParams.get('dir') || 'misc', name = url.searchParams.get('name');
      if (!safeName(dir) || !safeName(name)) { reply(400, 'Invalid screenshot name'); return; }
      if (Number(req.headers['content-length']) > maxBytes) { reply(413, 'Screenshot too large'); req.resume(); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > maxBytes) { reply(413, 'Screenshot too large'); req.resume(); return; }
        chunks.push(chunk);
      }
      const png = await decodePNG(Buffer.concat(chunks));
      if (!png) { reply(400, 'Invalid PNG data URL'); return; }
      const directory = path.join(root, dir);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${name}.png`), png);
      reply(200, 'ok');
    } catch {
      reply(500, 'Could not save screenshot');
    }
  };
}

export const shotSaver = () => ({
  name: 'shot-saver',
  configureServer(server) {
    server.middlewares.use('/__shot', createShotSaverMiddleware({ root: path.resolve(server.config.root, 'screenshots') }));
  },
});
