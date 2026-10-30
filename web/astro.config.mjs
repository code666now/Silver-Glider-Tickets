// @ts-check
import { defineConfig } from 'astro/config';

// Salida estática: Express (src/index.js) sirve web/dist. Las vistas son cascarones que
// llaman a /api con el JWT del navegador, así que no hace falta SSR ni adaptador.
export default defineConfig({
  output: 'static',
  build: {
    // dist/doorlist.html en vez de dist/doorlist/index.html: Express lo sirve por ruta.
    format: 'file',
  },
  vite: {
    server: {
      // `npm run dev` en web/ (puerto 4321) contra el micro corriendo en :3000.
      proxy: {
        '/api': 'http://localhost:3000',
        '/wallet': 'http://localhost:3000',
      },
    },
  },
});
