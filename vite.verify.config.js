// Verification server: no HMR and no file watching, so edits from the parallel sessions don't reload
// the page mid-capture. Restart it to pick up new code.  npx vite --config vite.verify.config.js
import base from './vite.config.js';

export default { ...base, server: { ...base.server, port: 5179, strictPort: true, hmr: false, watch: null } };
