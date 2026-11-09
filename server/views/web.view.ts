import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';

export function mountWebView(app: Express, distPath: string): void {
  app.use(express.static(distPath, {
    index: 'index.html',
    setHeaders: (response, filePath) => {
      const file = filePath.split(path.sep).join('/');
      // Los archivos de /assets llevan un hash en el nombre: nunca cambian, el navegador los conserva un año.
      if (file.includes('/assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // La página principal sí debe revisarse siempre para recoger las versiones nuevas.
      else if (file.endsWith('.html')) response.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'GET' || !request.accepts('html')) {
      next();
      return;
    }

    response.sendFile(path.join(distPath, 'index.html'));
  });
}
