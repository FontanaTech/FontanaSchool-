import { mountSimulator } from './simulator';
import { startActivityHeartbeat } from '../activity-heartbeat';
import { forwardToParent } from '../recovery-tools';

// Tipifica corre en un iframe: sus eventos de ratón y teclado no llegan a la página principal, así que avisa por su cuenta.
startActivityHeartbeat();
// Ctrl + Shift + L dentro del simulador abre el registro de la página principal; sus errores también llegan allí.
forwardToParent();

mountSimulator(document.querySelector<HTMLElement>('#app')!);
