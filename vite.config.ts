import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas absolutas: las pantallas profundas (/induccion/modulos/<modulo>/<seccion>) deben encontrar assets e imágenes.
  base: '/',
  // El frontend no usa variables de entorno: sin esto, cada cambio en .env reinicia Vite (y en la unidad de red
  // ese reinicio falla con «Cannot find module ... vite.config.ts.timestamp-...»).
  envDir: false,
  // Solo index.html es entrada: las copias de otras ramas (.mergejuan, .mergemain) tienen su propio index.html.
  // simulador/index.html es el clon de Control Next del módulo Tipifica (se muestra en un iframe en /simulador/).
  // lucide se preempaqueta: si no, el navegador pide cientos de módulos de íconos sueltos en desarrollo.
  optimizeDeps: { entries: ['index.html', 'simulador/index.html'], include: ['lucide'] },
  build: {
    rollupOptions: {
      input: { main: 'index.html', simulador: 'simulador/index.html' },
    },
  },
  server: {
    // El servidor solo acepta el origen http://127.0.0.1:5173 en desarrollo: si el puerto está ocupado, falla
    // en vez de saltar a otro (con otro puerto, cerrar sesión y demás acciones dan «Origen no permitido»).
    port: 5173,
    strictPort: true,
    // Transforma las entradas al arrancar: la primera carga no espera a que la unidad de red responda archivo por archivo.
    warmup: { clientFiles: ['./src/main.ts', './src/simulador/main.ts'] },
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      // Canal en vivo del panel de administración (WebSocket).
      '/ws': { target: 'http://127.0.0.1:3001', ws: true },
    },
    // Carpetas que no son del frontend: vigilarlas provocaba recargas masivas y reinicios de Vite.
    watch: {
      // La carpeta está en una unidad de red de Windows, donde fs.watch falla ("file watcher error: UNKNOWN").
      usePolling: true,
      interval: 500,
      ignored: (file) => {
        const path = file.replace(/\\/g, '/');
        if (/(?:^|\/)(?:\.local|\.mergejuan|\.mergemain|server-dist|prisma|dist|docs-assets|documentacion)(?:\/|$)/.test(path) || /(?:^|\/)\.env$/.test(path)) return true;
        // Este motor puro también lo importa el simulador: debe actualizarse en el navegador.
        // Se permite recorrer server/domain, pero se omiten los demás archivos del servidor.
        const server = /(?:^|\/)server(?:\/(.*))?$/.exec(path);
        return Boolean(server?.[1] && server[1] !== 'domain' && !/^domain\/excel-(practice|formula)\.ts$/.test(server[1]));
      },
    },
  },
});
