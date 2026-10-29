import { defineConfig } from 'vite';
import { shotSaver } from './scripts/shot-saver.js';

export default defineConfig({
  // Optional local capture endpoint: set GEET_SCREENSHOTS=1 before starting the dev server.
  plugins: process.env.GEET_SCREENSHOTS === '1' ? [shotSaver()] : [],
  // top-level await loads data/geo.json before the world modules evaluate
  // two pages: the explorer (index.html) and the game (game.html)
  // three.js and its addons get their own chunk: it rarely changes, so the browser keeps it cached across app deploys
  build: {
    target: 'es2022', chunkSizeWarningLimit: 800, // three.js alone is ~750 kB; anything bigger than that is app code worth splitting
    rolldownOptions: { input: { main: 'index.html', game: 'game.html' }, output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } } },
  },
  server: { port: 5173, watch: { ignored: ['**/screenshots/**'] } },
  // pre-bundle every three.js addon up front; discovering them lazily caused reload loops in dev
  optimizeDeps: {
    include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/SkeletonUtils.js',
      'three/addons/objects/Sky.js', 'three/addons/postprocessing/EffectComposer.js', 'three/addons/postprocessing/RenderPass.js',
      'three/addons/postprocessing/GTAOPass.js', 'three/addons/postprocessing/UnrealBloomPass.js', 'three/addons/postprocessing/OutputPass.js'],
  },
});
