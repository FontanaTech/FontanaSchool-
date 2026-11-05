# Así vivimos Fontana

Álbum interactivo de la página de inducción, después de la presentación. Muestra fotografías y videos del día a día de la empresa.

## Qué incluye

- Visor principal con transición suave, título, descripción y contador (01 / 08).
- Flechas, teclado (← →) y gesto de deslizar en celular.
- Tira de miniaturas; los videos llevan una insignia de reproducción.
- Filtros Todo / Fotos / Videos.
- Presentación automática opcional para fotografías (se pausa al pasar el cursor, no arranca sola).
- Vista ampliada con navegación; Escape, el botón de cierre o pulsar fuera la cierran y pausan el video.
- Los videos no se reproducen solos: se inician al pulsar el botón de reproducir.
- Los espacios sin archivo muestran un marcador elegante, sin simular fotos de la compañía.
- Respeta la preferencia de movimiento reducido.

## Añadir fotografías

Las fotos se optimizan antes de publicarse: el álbum no sirve los originales pesados.

1. Copiar el original (PNG o JPEG, a la resolución que tengas) a `media/vida-fontana/`. Esta carpeta es la fuente; **no** se publica.
2. Ejecutar `npm run album:optimize`. El script (`scripts/vida-fontana/optimizar-album.mjs`, con `sharp`) genera en `public/vida-fontana/` dos derivados WebP por foto —`<id>-thumb.webp` (720 px, para las hojas) y `<id>-full.webp` (hasta 1920 px, para la vista ampliada y el zoom)— y `portada.webp` a partir de `portada.*`. Imprime el antes/después y, con `--manifest`, los metadatos (ancho, alto, nombres) listos para el JSON.
3. Editar `public/vida-fontana/mural.json`: `src` apunta al `-full.webp` y `thumb` al `-thumb.webp`. Copia `width`/`height` (del `-full.webp`) y `thumbWidth`/`thumbHeight` (del `-thumb.webp`) tal como los imprime `--manifest`: `width`/`height` reservan el espacio de la vista ampliada y, comparando ambos pares, el álbum decide si al hacer zoom vale la pena subir del thumb al original (si el original no tiene más píxeles, no lo vuelve a descargar). El orden del archivo es el orden del álbum.
4. `title` se muestra en grande; `caption` (opcional) es la línea descriptiva; `alt` describe la imagen para lectores de pantalla. `featured: true` ocupa una página completa.

```json
{
  "id": "almuerzos-fin-de-mes",
  "kind": "photo",
  "title": "Almuerzos fin de mes",
  "caption": "Compartimos un momento de encuentro.",
  "alt": "Dos integrantes del equipo comparten un almuerzo en la oficina.",
  "src": "/vida-fontana/almuerzos-fin-de-mes-full.webp",
  "thumb": "/vida-fontana/almuerzos-fin-de-mes-thumb.webp",
  "width": 768,
  "height": 1024,
  "thumbWidth": 720,
  "thumbHeight": 960,
  "featured": true
}
```

## Añadir videos

Copiar el MP4 (H.264) y su portada a `public/vida-fontana/` y añadir el elemento con `kind: "video"`, `poster` (portada WebP) y, si existen, `captions` (subtítulos WebVTT). Los videos no pasan por el script de optimización.

```json
{
  "id": "encuentro-equipo",
  "kind": "video",
  "title": "Encuentro del equipo",
  "caption": "Un día de integración en la sede.",
  "src": "/vida-fontana/encuentro.mp4",
  "poster": "/vida-fontana/encuentro-portada.webp",
  "captions": "/vida-fontana/encuentro-es.vtt"
}
```

Las rutas deben ser locales y comenzar por `/`. No se modifica el avance ni se añade evaluación.
