# Fontana School Guide

Aplicación web de inducción de Fontana construida con TypeScript, Vite (frontend vanilla), Express 5 y Prisma 6 sobre PostgreSQL en Neon. Incluye acceso de asesores y administradores, la ruta de formación del asesor (módulos, estados, progreso y botones "Continuar") y el panel administrativo (usuarios, catálogo, reactivaciones, certificados, métricas y auditoría).

El contenido de capacitación (cuestionarios, audios, simulaciones y ejercicios definitivos) todavía no existe: cada módulo muestra "Contenido en preparación".

## Arquitectura

```text
Navegador ── /api/* ──► routes ──► middleware (requestId, mismaProcedencia, auth, validate)
                                     │
                                     ▼
                                controllers (HTTP: leer request, llamar servicio, responder)
                                     │
                                     ▼
                                services (reglas, transacciones, auditoría)
                                     │
                                     ▼
                                repositories (consultas Prisma, cursor, agregaciones SQL)
                                     │
                                     ▼
                                PostgreSQL (esquema induccion)
```

| Carpeta | Responsabilidad |
| --- | --- |
| `src/` | Frontend. `auth-ui.ts` (login, perfil y enrutado), `advisor/` (ruta de formación), `admin/` (panel), `http.ts` (cliente de la API), `training.ts` y `content.ts` (recorrido existente). |
| `server/config/` | `env.ts` (variables validadas con zod), `prisma.ts` (cliente único), `security.ts` (constantes de seguridad). |
| `server/domain/` | Constantes de rol y estado (`enums.ts`), errores (`errors.ts`), reglas puras de progreso (`progress.ts`) y del usuario. |
| `server/middleware/` | `auth` (requireAuth, requireRole, CSRF), `errors`, `rateLimit`, `requestId`, `validate`. |
| `server/validators/` | Esquemas zod por recurso (`.strict()` rechaza campos no permitidos). |
| `server/services/` | Reglas de negocio. Toda escritura administrativa va en transacción con `AdminAuditLog`. |
| `server/repositories/` | Consultas Prisma y SQL agregado. Los controladores no llaman a Prisma. |
| `server/integrations/` | Webhook de mecanografía (borrador) e interfaz de almacenamiento. |
| `server/__tests__/` | Pruebas con vitest y supertest. |
| `prisma/` | Esquema, migraciones, seeds y guardián de entorno. |

### Roles, estados y sesiones

- `usuarios.rol` (`asesor`, `administrador`) y `usuarios.estado` (`activo`, `inactivo`, `bloqueado`) siguen siendo varchar protegidos por los CHECK existentes en la base. Sus valores están en `server/domain/enums.ts`.
- La cookie `fontana_session` es HttpOnly, SameSite=Lax, firmada con HMAC y dura 8 horas. Lleva `{ userId, version, expires }`: desactivar, bloquear, cambiar el rol o restablecer la contraseña incrementa `version_sesion` y las sesiones abiertas dejan de servir de inmediato. "Cerrar todas las sesiones" (`POST /api/auth/logout-all`) hace lo mismo.
- Inicio de sesión: el asesor usa su documento; el administrador, documento o correo. Nunca por nombre. Las respuestas de error son genéricas y se limita a 5 fallos por IP + identificador y 25 por IP cada 15 minutos (en memoria, una instancia).
- Todas las fechas se guardan en UTC y se presentan en `APP_TIMEZONE` (America/Bogota). Notas y porcentajes usan `Decimal(5,2)` calculados en el servidor.

### Experiencia y ruta de práctica

Al terminar las cinco etapas de `/induccion`, la confirmación de lectura habilita la pregunta de experiencia. Al responder, `POST /api/auth/experiencia` guarda `tiene_experiencia_cobranzas_digitales` y `fecha_respuesta_experiencia`; desde entonces el asesor entra a `/practica/experiencia` o `/practica/nuevo` (destino del módulo 02, todavía sin ejercicios). Puede volver a `/induccion` para repasar, donde también ve "Tu ruta de formación". El servidor exige sesión, rol asesor, perfil completo y un valor booleano.

### Reglas de la ruta de formación

- Catálogo inicial: 1 Ofimática para tus cobranzas → 2 Inducción a las cobranzas → 3 Enfréntate a la objeción → 4 Tipifica (práctica en el clon de Control Next) → 5 Certificado (requiere los cuatro sellos).
- `computeModuleViews` (dominio) calcula el estado efectivo de cada módulo combinando el estado del catálogo, prerrequisitos, sellos, progreso, intentos y excepciones vigentes. La usan el área del asesor, el panel y la sincronización que alimenta las métricas.
- Un módulo `INACTIVE` se muestra "No disponible", con el botón deshabilitado. Un módulo aprobado muestra "Completado"; el módulo 1 tiene pantalla de resultado y sigue abierto para repasarlo (los demás se habilitarán cuando tengan la suya).
- Intentos: numeración consecutiva con bloqueo de fila, límite `maxAttempts` más excepciones vigentes y espera `waitMinutes` tras un fallo. Una configuración evaluable nueva crea otra versión; nunca se edita una versión existente.
- Excepciones individuales (`REACTIVATE`, `UNLOCK`, `EXTRA_ATTEMPT`, `RESET_WAIT`, `REOPEN_MODULE`): motivo obligatorio, encabezado `Idempotency-Key` (UUID), nunca se borran; se revocan o vencen. `REOPEN_MODULE` no revoca sellos ni certificados.
- Certificados sin PDF: código `FSG-AAAA-XXXXXX`, anulación y reemisión enlazada. La emisión automática está detrás de `CERTIFICATES_ENABLED=false`.
- Intentos, resultados, sellos, certificados, excepciones y auditoría usan `onDelete: Restrict`; la auditoría solo se inserta.

## Módulo Ofimática

"Ofimática para tus cobranzas" es el módulo 1 de la ruta (`slug` `ofimatica-mecanografia`). Tiene cinco secciones que son actividades del catálogo:

| Orden | Sección | Tipo | Obligatoria | Ruta |
| --- | --- | --- | --- | --- |
| 10 | Bienvenida | `LESSON` | No | `/induccion/modulos/ofimatica-mecanografia/bienvenida` |
| 20 | Mecanografía | `TYPING` | Sí | `.../mecanografia` |
| 30 | Excel para cobranzas | `EXCEL_PRACTICE` | Sí | `.../excel` |
| 40 | Ortografía aplicada | `DICTATION` | Sí | `.../ortografia` |
| 50 | Resultado y sello | `LESSON` | No | `.../resultado` |

El sello se emite cuando las tres actividades obligatorias están aprobadas, una sola vez, y desbloquea la Inducción a las cobranzas. El placeholder anterior (orden 1) queda `ARCHIVED` y se conserva.

- **El servidor decide.** El navegador nunca calcula una nota que cuente, nunca aprueba una sección ni emite el sello.
- **Mecanografía propia** (sin proveedores externos): el servidor entrega el texto y un `nonce` (solo se guarda su SHA-256), registra el inicio oficial y calcula caracteres correctos por minuto, PPM, precisión y errores al cerrar. Un intento ya cerrado, de otro asesor, con `nonce` inválido o fuera de ventana se rechaza. Un intento abandonado o vencido cuenta como fallido. Tras fallar hay que completar una práctica breve (`last_practice_at`).
- **Evaluación de Excel**: 10 preguntas de opción múltiple (A–D) sobre uso básico (SUMA, resta, Autosuma, filtro, ordenar, Ctrl + C/V/X/Z/B/G y formato de moneda), cada una con un caso ilustrado que imita la ventana de Excel. El orden depende de una semilla por intento y la clave de respuestas nunca viaja al navegador (`server/domain/excel-quiz.ts`). Las ilustraciones están en `src/office/imagenes` y se regeneran con `node docs-assets/ofimatica/generar-imagenes-excel.cjs src/office/imagenes`.
- **Dictado con sistema experto determinístico** (`server/domain/spelling/`): nota = 100 menos el peso de cada error; aprueba con la nota mínima y sin errores críticos. **Ollama nunca califica**: solo redacta recomendaciones sobre un resultado ya calculado; si falla o está desactivado se usa la plantilla.
- **Configuración versionada** (`config_modulo_ofimatica`): cada cambio crea una versión nueva, archiva la anterior, sincroniza las evaluaciones y se audita con motivo. Cada intento guarda su `configSnapshot`. Se administra en el panel: **Ofimática** → *Configuración*.
- **Audios e imágenes** en almacenamiento privado (`STORAGE_DIR`), entregados por `GET /api/media/:key?exp&sig` con firma HMAC, vencimiento corto y sesión activa. Las 6 imágenes se generan una sola vez (ver `docs-assets/ofimatica/IMAGENES.md`) y se suben desde el panel.

### Variables del módulo

| Variable | Uso |
| --- | --- |
| `STORAGE_DIR` | Carpeta de audios e imágenes. Fuera del repositorio y de `dist/`, en almacenamiento persistente. |
| `MEDIA_SIGNING_SECRET` | Firma de las URL de archivos (si falta, se usa `SESSION_SECRET`). |
| `MEDIA_URL_TTL_SECONDS` | Vigencia de una URL firmada. Por defecto 300. |
| `OLLAMA_ENABLED` | `true` activa las recomendaciones con Ollama local. Por defecto `false`. |
| `OLLAMA_URL` | URL interna de Ollama (red privada). Nunca llega al navegador. |
| `OLLAMA_MODEL` | Modelo pequeño local para español. Por defecto `llama3.2:3b`. |
| `OLLAMA_TIMEOUT_MS` | Tiempo máximo por llamada. Por defecto 5000, con un reintento. |
| `DICTATION_DEV_TTS` | Solo desarrollo y pruebas: reproduce el dictado con la voz del navegador. Se ignora en producción. |
| `TRUST_PROXY` | `false` por defecto; con proxy interno, el número de saltos (por ejemplo `1`). |

### Datos y pruebas

```powershell
npm.cmd run db:seed        # catálogo, actividades, configuración, 6 textos, escenario de Excel, reglas y 3 dictados (borrador)
npm.cmd run db:seed:demo   # asesores demo con intentos reales sobre las actividades nuevas
npm.cmd run test:unit      # algoritmos puros (mecanografía, Excel, ortografía, Ollama simulado), sin base de datos
npm.cmd test               # suite completa con supertest (requiere DATABASE_URL_TEST)
```

Los ejercicios de dictado quedan en **borrador** hasta subir el audio autorizado desde el panel. En desarrollo, `DICTATION_DEV_TTS=true` los activa con la voz del navegador (la interfaz lo marca como audio de prueba). Asesores demo del módulo: `1000000102` (en curso), `1000000103` (aprobado), `1000000104` (sin intentos), `1000000146` (mecanografía aprobada), `1000000147` (práctica pendiente), `1000000148` (dictado con error crítico), `1000000149` (módulo completo), `1000000150` (intento vencido).

Para probarlo: inicia sesión con un asesor demo → "Tu ruta de formación" → **Ofimática para tus cobranzas**.

### Audios del dictado

Cada ejercicio tiene un audio generado con **voz sintética local** que lee exactamente su `expectedText`. No hay voces grabadas ni servicios en la nube.

- **Motor:** [Piper](https://github.com/rhasspy/piper) 1.8 (voz neuronal offline), con la voz `es_MX-claude-high` de `rhasspy/piper-voices` (licencia Apache-2.0 según su `MODEL_CARD`). Si Piper no está disponible, se usa la voz de Windows en español (SAPI).
- **Instalación (una vez por equipo, idempotente):** `powershell -ExecutionPolicy Bypass -File server/scripts/tts/setup-tts.ps1`. Instala Python 3.12, `piper-tts` (pip --user), la voz (en `%LOCALAPPDATA%\fontana-tts\voices`, fuera del repositorio) y `ffmpeg` con winget, y deja la configuración en `%LOCALAPPDATA%\fontana-tts\config.json`.
- **Generar y validar (sin escribir nada):** `npm.cmd run dictation:audio`. Los archivos quedan en `%TEMP%\fontana-dictado` para escucharlos.
- **Cargar y asociar:** `npm.cmd run dictation:audio -- --apply --admin-documento <documento de un administrador>`. Agrega `--no-activate` para dejar el ejercicio en borrador, `--only <key>` para uno solo y `--force-audio` para regenerar uno que ya tiene audio. Usa `uploadMedia` (valida bytes mágicos y tamaño) y `updateDictation` (audita y exige que el audio exista para activar).
- **Requisitos que valida el script:** OGG Opus mono 48 kHz a 48 kbps normalizado a -16 LUFS; entre 20 y 30 s (busca 24 a 28 s ajustando el ritmo de Piper entre 1.0 y 1.3); menos de 2 MB; sin silencios de más de 2 s ni saturación; nombre `dictado-<key>-v<version>.ogg`. Si no lo logra en 3 intentos, no carga ese ejercicio y lo informa.
- **Dónde viven:** en `STORAGE_DIR` (por defecto `../fontana-storage`, fuera del repositorio y de `dist/`). No se versionan en Git porque se regeneran con el script. En producción `STORAGE_DIR` debe apuntar a un disco persistente del servidor.
- **Ejercicio nuevo:** créalo en el panel (Ofimática › Dictados) en borrador y ejecuta el script con `--only <key>`. Si cambias el `expectedText` de un ejercicio con intentos, se crea una versión nueva y hay que generar su audio.

## Módulo 02 · Inducción a las cobranzas

Ruta: `/induccion/modulos/induccion-cobranzas`. Se conservan la sesión, el perfil completo, los prerrequisitos del catálogo y el recorrido por experiencia: quien debe realizar la teoría completa los cinco bloques; el examen final valida el conocimiento y habilita el simulador al aprobarse.

Los bloques 02 a 05 continúan el caso ficticio F-204 de Camila Rojas:

- **02 · Preparación:** revisar ficha e historial, consultar la actualización y verificar el saldo de $400.000 después del abono confirmado de $80.000. Al verificarlo se habilita continuar al bloque 03.
- **03 · Contacto y escucha:** saludo, presentación de CONSULTORIAS JURIDICAS para MARKETING PERSONAL y aviso de grabación y monitoreo por efectos de calidad con un reto breve. El informe del saldo usa un guion corto y destacado: «Señora Camila, su saldo pendiente con MARKETING PERSONAL es de $400.000. ¿Qué posibilidad de pago tiene en este momento?». Después de leerlo, el asesor pulsa «Practicar sin mirar» y completa cartera, saldo y pregunta, con corrección y reintentos. El guion sigue disponible como ayuda desplegable. La presentación se personaliza al escribir.
- **04 · Alternativas:** cuatro tarjetas explican Pago total, Abono + fechas, Descuento con el líder (validarlo antes de ofrecerlo) y Fecha Acuerdo Pago total (una fecha para cancelar el saldo completo; un compromiso no es un pago confirmado). Un reto presenta cuatro mini casos ficticios, uno a la vez: elegir correctamente avanza al siguiente; un error da una explicación y permite reintentar. Al resolver los cuatro casos se completa la práctica y aparece el botón para continuar al bloque 05. Los mini casos no cambian el resultado de Camila, que todavía no confirma monto ni fecha.
- **05 · Cierre y seguimiento:** cuatro casos secuenciales de tipificación, en este orden: No hubo acuerdo, Voluntad de pago, Contacto con un tercero y El cliente no contesta. Cada caso muestra primero el desplegable y debajo una situación ficticia breve de Camila. Una respuesta correcta abre el siguiente caso y limpia la selección; una incorrecta explica el motivo y permite reintentar sin avanzar. Los casos futuros no se pueden seleccionar. Solo al acertar los cuatro se habilita continuar al examen. Al finalizar se pueden consultar ejemplos breves de registro. Son etiquetas didácticas, pendientes de validación interna.

Cada bloque tiene pasos numerados y avance local independiente. Los errores mantienen el paso actual y permiten reintentos. Al acertar se abre el siguiente paso; al terminar aparece el botón para guardar la finalización del bloque y continuar. El servidor sigue exigiendo los bloques anteriores mediante `POST /api/training/collections/blocks/:key/complete`. Los borradores se mantienen mientras el módulo está abierto; al recargar, se conserva el avance de bloques guardado por el servidor y se puede rehacer la práctica del bloque habilitado con los datos del escenario. No se registra una gestión real de cliente.

Los nombres de las entidades provienen del guion suministrado por el usuario; el caso y los datos personales son ficticios. Grabación, monitoreo e identidad verificada son supuestos explícitos de la simulación, que no realiza llamadas ni grabaciones. El guion, las fuentes, las condiciones de contacto, las alternativas, la liquidación y las tipificaciones reales requieren validación interna. No se incorporan afirmaciones jurídicas sin soporte, instrucciones de cobrar usura ni recargos fijos de $200.000.

**Conceptos básicos** conserva cinco tarjetas: conocimiento del producto, manejo de objeciones, protocolo de la llamada, conocimiento de la marca y su cartera, y habilidad de negociar. Solo se ve la tarjeta actual; se navega con las flechas de pantalla o teclado. El reto rápido se presenta dentro del mismo carrusel y el botón para continuar está en su pantalla final.

El examen final v2 tiene siete secciones prácticas: inicio (15 puntos), identificación del escenario (10), negociación (20), objeciones (15), cierre (15), seguimiento (10) y tipificación (15). Combina selección, desplegables y tres respuestas escritas. Aprobación didáctica: 80/100 y ningún error crítico. Se consideran críticos divulgar datos sin identidad verificada, aprobar condiciones no autorizadas, amenazar sin soporte, registrar un pago sin verificar o inventar reglas de contacto. Estos criterios y las condiciones reales requieren validación interna. La redacción usa una rúbrica automática de elementos básicos y detección limitada de afirmaciones explícitas de riesgo; no certifica por sí sola la preparación laboral y requiere revisión del líder.

Las secciones se abren en orden al responder, sin exigir aciertos ni revelar correcciones durante el intento. `POST /api/training/collections/exam/start` crea o retoma el borrador; `POST /api/training/collections/exam/sections/:section` guarda una sección, sin calificarla. El servidor impide saltos y cambios en secciones ya guardadas. Tras completar las siete, `POST /api/training/collections/exam` califica el borrador guardado. Presenta «Apto» o «Requiere refuerzo», puntaje por sección, errores críticos, fortalezas, mejoras y referencias de corrección. Un reenvío idéntico por fallo de red no cuenta como otro intento.

Se usan las filas JSON existentes de `progreso_bloques_cobranzas`: `examen-borrador` guarda el intento en curso, `examen` el último resultado y `examen-intento-N` un registro histórico con versión, fecha, respuestas y resultado. No hay cambios de esquema ni se reinicia la teoría o las aprobaciones previas. La revisión de un nuevo intento conserva el sello ya obtenido. Se mantienen `GET /api/training/collections/module`, la finalización de bloques y el cuestionario legado.

En el panel administrativo, abrir la ficha del asesor y consultar **Examen final de cobranzas**. Muestra fecha, número de intento, puntaje total y resultado; el informe desglosa las siete secciones, errores críticos, fortalezas y actividades concretas de refuerzo, con la respuesta individual como evidencia. El último puntaje se compara con el intento anterior solo si pertenecen a la misma versión. El historial se recorre en páginas de 20 registros, sin eliminar los más antiguos. Las rutas `GET /api/admin/advisors/:id/collections-exams?cursor=…` y `GET /api/admin/advisors/:id/collections-exams/:attemptId` requieren rol administrador y acotan cada consulta al asesor indicado.

Los nuevos intentos conservan también el enunciado, el texto de la respuesta elegida y las recomendaciones, generadas al enviar el examen. Los informes históricos se leen sin recalificarlos; para los primeros registros v2 sin recomendaciones, se construyen desde el resultado guardado. `npx tsx server/scripts/backfill-collections-exam-reports.ts` consulta cuántos informes pueden completarse; `--apply` guarda únicamente recomendaciones faltantes, sin modificar respuestas, puntajes, fechas de envío ni aprobaciones. El reinicio del curso de la cuenta de pruebas conserva estos archivos y los siguientes intentos no reutilizan sus números.

La interfaz usa crema, vino y dorado de Fontana, pasos destacados, corrección breve y vistas adaptables a pantallas pequeñas. El botón para consultar la fuente brilla hasta utilizarse y después indica que ya se consultó; las animaciones respetan la preferencia de movimiento reducido.

## Desarrollo local

Requiere Node.js 22.12 o superior. En Windows:

```powershell
.\Iniciar-FontanaSchool.cmd
```

El lanzador comprueba el entorno, instala dependencias si faltan, inicia ambos servidores y abre el navegador. También puede hacerse a mano:

```powershell
npm.cmd install
npm.cmd run dev
```

- Frontend: `http://127.0.0.1:5173/` (Vite redirige `/api` a Express).
- Backend: `http://127.0.0.1:3000/`; estado del servidor y la base en `GET /api/health`.

| Comando | Uso |
| --- | --- |
| `npm run dev` | Frontend y backend con recarga. |
| `npm run check` | Tipos del frontend, del servidor y de pruebas/seeds. |
| `npm test` | Pruebas (requiere `DATABASE_URL_TEST`). |
| `npm run test:unit` | Pruebas de algoritmos puros, sin base de datos. |
| `npm run build` | Genera Prisma Client y compila todo. |
| `npm start` | Ejecuta `server-dist/server.js`. |
| `npm run db:seed` | Catálogo inicial y asesor de prueba. |
| `npm run db:seed:demo` | Datos demo (ver abajo). |
| `npm run db:seed:demo:clean -- --yes` | Borra solo los datos demo. |
| `npm run admin:bootstrap` | Crea el administrador inicial si no existe (muestra la contraseña una sola vez en esa terminal). |

Al arrancar, el servidor ya no crea administradores ni imprime contraseñas: si no existe ninguno muestra "No existe administrador; ejecuta npm run admin:bootstrap".

## Variables de entorno

Copia `.env.example` como `.env`. `.env` está ignorado por Git y nunca debe subirse.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión agrupada (pooler) de la aplicación. |
| `DIRECT_URL` | Conexión directa para migraciones. |
| `PORT` | Puerto HTTP. |
| `NODE_ENV` | `development`, `production` o `test`. |
| `SESSION_SECRET` | Firma de cookies; obligatoria (≥ 32 caracteres) en producción. |
| `APP_TIMEZONE` | Zona de presentación y de los filtros de fecha. Por defecto `America/Bogota`. |
| `STALLED_DAYS` | Días sin avance para "asesores detenidos". Por defecto 7. |
| `CERTIFICATES_ENABLED` | `true` activa la emisión automática de certificados. Por defecto `false`. |
| `TYPING_WEBHOOK_SECRET` | Activa el webhook de mecanografía (sin él, la ruta responde 404). |
| `DATABASE_URL_TEST`, `DIRECT_URL_TEST` | Base de pruebas (rama de Neon o PostgreSQL local). Nunca la de producción. |
| `SEED_ALLOW` | Debe ser `true` para ejecutar seeds. |
| `SEED_ALLOWED_HOSTS` | Hosts no locales en los que se permite sembrar (por ejemplo, la rama de pruebas de Neon). |
| `PRODUCTION_DATABASE_HOSTS` | Hosts de producción: los seeds y las pruebas se niegan a usarlos. |

## Prisma y migraciones

El esquema Prisma refleja la tabla existente `induccion.usuarios`, creada fuera de Prisma. La migración `prisma/migrations/0_baseline_usuarios` es la **línea base**: describe esa tabla tal como existe en Neon, incluidos los objetos que Prisma no modela (CHECK `chk_usuarios_rol` y `chk_usuarios_estado`, índice único `uq_usuarios_correo_lower`, trigger `trg_usuarios_fecha_actualizacion` y la vista `usuarios_ruta_induccion`). Se comprobó con `prisma migrate diff` que una base creada desde la línea base es idéntica a la real.

La migración `20261015162347_backend_training_admin` agrega `usuarios.version_sesion` (con valor por defecto 0), los enums y las tablas nuevas. No contiene `DROP`. Incluye SQL manual revisado: índices únicos parciales (un sello `ACTIVE` por usuario y módulo, un certificado `ACTIVE` por usuario) y CHECK de integridad de las tablas nuevas.

### Registrar la línea base (una sola vez por base existente)

En la base que ya tiene `induccion.usuarios` la línea base **no se ejecuta**: solo se marca como aplicada. Hazlo primero en una rama de pruebas de Neon y, al desplegar, en producción (requiere aprobación):

```powershell
npx.cmd prisma validate
npx.cmd prisma migrate resolve --applied 0_baseline_usuarios
npx.cmd prisma migrate deploy
```

En una base vacía (rama nueva de Neon, PostgreSQL local) basta con `npx.cmd prisma migrate deploy`.

Las nuevas migraciones se crean revisando el SQL antes de aplicarlo:

```powershell
npx.cmd prisma migrate dev --create-only --name nombre_descriptivo
# revisar prisma/migrations/<fecha>_nombre_descriptivo/migration.sql
npx.cmd prisma migrate dev
```

Nunca se usan `prisma migrate reset` ni `prisma db push`, y nunca se modifica una migración ya aplicada en producción. Los `.sql` de migraciones se guardan con finales de línea LF (`.gitattributes`) para que su checksum no cambie entre equipos.

### Orden de despliegue en Render

1. Con aprobación, marcar la línea base en la base de producción: `npx prisma migrate resolve --applied 0_baseline_usuarios`.
2. Cambiar en `render.yaml` el `buildCommand` a `npm ci && npm run build && npx prisma migrate deploy`. **No antes del paso 1**: sin la línea base marcada, `migrate deploy` intentaría crear `usuarios` y el despliegue fallaría.
3. Desplegar. `migrate deploy` aplica `backend_training_admin` antes de que arranque el código nuevo, que necesita `version_sesion`.
4. Ejecutar `npm run db:seed` contra producción solo para el catálogo, con aprobación (requiere quitar el host de `PRODUCTION_DATABASE_HOSTS` de forma consciente) o crear el catálogo desde una migración de datos cuando se apruebe.

## Seeds y datos demo

Los seeds se niegan a correr con `NODE_ENV=production`, sin `SEED_ALLOW=true`, contra un host de `PRODUCTION_DATABASE_HOSTS` o contra un host no local que no esté en `SEED_ALLOWED_HOSTS`. No imprimen contraseñas.

- `npm run db:seed`: catálogo de la sección 6.1 con una actividad `PLACEHOLDER` por módulo y el asesor de prueba **Asesor Prueba Fontana**, documento `1000000001`, contraseña `FontanaTest2026!`.
- `npm run db:seed:demo`: crea, a través de los servicios reales, un administrador demo y 45 asesores demo con todos los estados a revisar. Identificación: documentos `1000000100`–`1000000199`, correos `@demo.fontana.test`, nombres `Demo · ...`, motivos e `idempotencyKey` `demo-...`, certificados `FSG-DEMO-...`. Es idempotente: si el asesor ya existe, su escenario no se repite.
- `npm run db:seed:demo:clean`: muestra cuántos registros demo borraría; con `-- --yes` los elimina en una transacción (única excepción a la regla de no borrar historial).

Contraseñas demo: asesores `FontanaDemo2026!`; administrador demo (`1000000100`) `FontanaAdminDemo2026!`.

### Lista de verificación manual (punto de control 1)

Ejecuta `npm run db:seed` y `npm run db:seed:demo` sobre la base de desarrollo, luego `npm run dev` y abre `http://127.0.0.1:5173/login`.

| Documento | Entra como | Qué abrir | Qué se debe ver |
| --- | --- | --- | --- |
| 1000000100 | Administración | `/admin` | Panel con Asesores, Módulos y actividades, Métricas y Auditoría. |
| 1000000101 | Asesor | login | Va a "Llena tus datos"; después, módulo 1 disponible y el resto bloqueados. |
| 1000000102 | Asesor | `/induccion` | Módulo 1 "En curso" con "Continuar". |
| 1000000103 | Asesor | `/induccion` | Módulo 1 "Completado", módulo 2 con "Continuar", módulo 3 "Aprueba Inducción a las cobranzas para continuar". |
| 1000000104 | Asesor | `/induccion` | Módulo 1 "Sin intentos" y botón deshabilitado. En el panel, su ficha muestra 0 intentos restantes. |
| 1000000105 | Asesor | `/induccion` | Módulo 1 con la hora a partir de la cual podrá reintentar (30 min tras el fallo). |
| 1000000106 | Asesor / panel | `/induccion`, ficha | "Continuar" de nuevo; en la ficha, próximo intento número 4 y excepción vigente. |
| 1000000107 | Panel | ficha | Excepción UNLOCK "Vencida"; el asesor ve el módulo 2 bloqueado. |
| 1000000108 | Panel | ficha | Excepción REACTIVATE "Revocada"; el módulo 1 sigue sin intentos. |
| 1000000109 | Asesor / panel | `/induccion`, ficha | Certificado con "Ver certificado"; en la ficha, FSG-DEMO-0001 activo y tres sellos. |
| 1000000110 | Panel | ficha | FSG-DEMO-0002 anulado con motivo y FSG-DEMO-0003 activo que lo reemplaza. |
| 1000000111 | Asesor | `/induccion` | Certificado bloqueado: "Te faltan los sellos de: Tipifica". |
| 1000000112 | Panel | Métricas | Aparece en "Asesores detenidos" (7 días). |
| 1000000113 | Asesor / panel | login, ficha | No inicia sesión; su historial de intentos sigue visible. |
| 1000000114 | Asesor / panel | login, Auditoría | Mensaje genérico al entrar; el bloqueo y su motivo están en auditoría. |
| 1000000115 | Asesor | `/induccion/modulos/induccion-cobranzas` | Puede entrar al módulo 2 reabierto y conserva el sello. |
| 1000000116–145 | Panel | Asesores, Métricas | Paginación "Cargar más", filtros por módulo/estado/fecha y métricas con datos. |

En **Módulos y actividades** aparece "Demo · actividad retirada" inactiva con progreso previo de dos asesores (la desactivación conserva el historial).

## Pruebas

```powershell
# .env: DATABASE_URL_TEST y DIRECT_URL_TEST apuntando a la base de pruebas
npm.cmd test
```

`global-setup.ts` aplica `prisma migrate deploy`, el seed base y vuelve a sembrar los datos demo. Cada suite crea usuarios con documento `TEST-<suite>-...` y borra solo esos datos al terminar. Para una base local desechable sirve cualquier PostgreSQL 15+ (por ejemplo, `postgresql://usuario@127.0.0.1:5432/fontana_test`).

## API

| Método y ruta | Uso | Rol |
| --- | --- | --- |
| `POST /api/auth/login` | Iniciar sesión (`identificador`, `password`, `tipo`). | Público, con rate limit |
| `POST /api/auth/logout` | Cerrar sesión. | Autenticado |
| `POST /api/auth/logout-all` | Cerrar todas las sesiones del usuario. | Autenticado |
| `GET /api/auth/me` | Usuario, ruta y permisos. | Autenticado |
| `POST /api/auth/completar-datos` | Datos personales, documento, contacto, emergencia y cuenta bancaria del asesor. | Asesor |
| `POST /api/auth/experiencia` | Guarda la experiencia y asigna la ruta de práctica. | Asesor con perfil completo |
| `GET /api/advisor/modules` | Ruta, progreso y botones. | Asesor |
| `GET /api/advisor/modules/:slug` | Acceso validado a un módulo (403 con `blockedReason`). | Asesor |
| `GET /api/advisor/progress` | Resumen personal. | Asesor |
| `GET/POST /api/admin/users` | Listar (filtros y cursor) y crear. | Administrador |
| `PATCH /api/admin/users/:id` | Editar datos permitidos. | Administrador |
| `PATCH /api/admin/users/:id/status` | Activar, desactivar o bloquear (motivo). | Administrador |
| `POST /api/admin/users/:id/reset-password` | Contraseña temporal. | Administrador |
| `GET /api/admin/advisors/:id/progress` | Ficha completa. | Administrador |
| `GET /api/admin/modules` | Módulos, actividades y evaluaciones. | Administrador |
| `PATCH /api/admin/modules/:id/status`, `PATCH /api/admin/activities/:id/status` | Activar o desactivar (motivo). | Administrador |
| `POST /api/admin/activities/:id/evaluations` | Nueva versión evaluable. | Administrador |
| `POST /api/admin/advisors/:userId/activities/:activityId/reactivate` | Excepción individual (`Idempotency-Key`). | Administrador |
| `POST /api/admin/overrides/:id/revoke` | Revocar excepción. | Administrador |
| `POST /api/admin/certificates/:id/revoke`, `/reissue` | Anular o reemitir. | Administrador |
| `GET /api/admin/metrics/summary`, `/metrics/location`, `/metrics/modules/:moduleId` | Métricas. | Administrador |
| `GET /api/admin/audit` | Auditoría de solo lectura. | Administrador |
| `POST /api/integrations/typing/webhook` | Resultado externo idempotente (borrador). | Integración |
| `GET /api/health` | Estado del servidor y la base. | Público |

Respuestas nuevas: `{ "data": ..., "meta": { "nextCursor": ... } }`. Errores: `{ "status": "error", "code", "message", "details", "requestId" }`.

Las rutas `/api/admin/asesores` se mantienen como alias **obsoletos** que usan los mismos servicios; el panel ya usa las rutas nuevas.

### Webhook de mecanografía (borrador)

Sin proveedor real. Si `TYPING_WEBHOOK_SECRET` no está definido responde 404. Si lo está:

- Encabezado `X-Typing-Signature: sha256=<hex de HMAC-SHA256 del cuerpo crudo>`.
- Cuerpo: `{ "eventId", "numeroDocumento", "wpm", "accuracy", "errors", "attemptId"?, "occurredAt"? }`.
- Un `(provider, eventId)` repetido responde 200 con `DUPLICATE` sin reprocesar.

## Documentación local

La carpeta `documentacion/` es local y está en `.gitignore`. Al hacer pull de este cambio, Git la eliminará de las copias que no la tengan modificada: respáldala antes o recupérala con `git show 949dece^:documentacion/<archivo>`. Lo que seguía vigente de esos archivos está en este README.

## Aplicación de escritorio (Electron)

El instalador `.exe` incluye la aplicación compilada, los audios del dictado (`storage/`) y la conexión a la base de datos (uso corporativo interno). La conexión sale del `.env` del equipo que genera el instalador y **nunca se sube a GitHub**.

- `npm run desktop:instalador`: compila la interfaz y el servidor, arma `FontanaSchool-Setup-<versión>.exe` y lo deja en la carpeta **Descargas**. Requiere un `.env` con `DATABASE_URL` y un `SESSION_SECRET` de al menos 32 caracteres.
- `npm run desktop:publicar`: lo mismo y además publica la versión compilada (sin la conexión) como release `desktop-…` en GitHub. Solo desde `main` y sin cambios pendientes. Usa la sesión de GitHub que ya tiene git en el equipo.
- `npm run desktop:actualizacion`: solo publica la actualización, sin armar el instalador.

Cada commit que llega a `main` se publica solo: el flujo de GitHub Actions `.github/workflows/desktop-release.yml` revisa tipos, corre las pruebas unitarias y crea el release `desktop-…` (conserva los 10 más recientes). Los comandos de publicación manual quedan para casos especiales.

En la aplicación instalada, el botón **«Buscar actualizaciones»** del inicio de sesión consulta el último release `desktop-…`, lo descarga y reinicia la aplicación con esa versión. Si el cambio toca la aplicación de escritorio en sí (`electron/`), hay que reinstalar con un instalador nuevo.

El servidor corre dentro de la aplicación en `http://localhost:3087`. Los archivos de compilación quedan en `%TEMP%\fontana-desktop-build`.
