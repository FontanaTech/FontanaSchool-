import './auth.css';
import { iniciarInterfaz } from './auth-ui';
import { showAppLoadingError } from './loading';
import { startActivityHeartbeat } from './activity-heartbeat';

// Mientras el asesor mueve el ratón o escribe, las conexiones a la base siguen abiertas (lectura sin clics incluida).
startActivityHeartbeat();

// Una restauración del navegador debe consultar de nuevo qué intentos siguen abiertos.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

void iniciarInterfaz().catch(showAppLoadingError);
