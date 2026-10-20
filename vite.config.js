import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// dev-only endpoint: POST a PNG data URL to /__shot?dir=m1&name=field -> screenshots/m1/field.png
const shotSaver = () => ({
  name: 'shot-saver',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const u = new URL(req.url, 'http://x'), safe = s => (s || '').replace(/[^\w-]/g, '');
      const dir = path.join(process.cwd(), 'screenshots', safe(u.searchParams.get('dir')) || 'misc');
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, safe(u.searchParams.get('name')) + '.png'), Buffer.from(body.split(',')[1] || '', 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [shotSaver()],
  // top-level await loads data/geo.json before the world modules evaluate
  // two pages: the explorer (index.html) and the game (game.html)
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: 'index.html', game: 'game.html' } } },
  server: { port: 5173, watch: { ignored: ['**/screenshots/**', '**/legacy/**'] } },
  // pre-bundle every three.js addon up front; discovering them lazily caused reload loops in dev
  optimizeDeps: {
    include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/SkeletonUtils.js',
      'three/addons/objects/Sky.js', 'three/addons/postprocessing/EffectComposer.js', 'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/GTAOPass.js', 'three/addons/postprocessing/UnrealBloomPass.js', 'three/addons/postprocessing/OutputPass.js'],
  },
});
