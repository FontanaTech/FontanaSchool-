import { mountSimulator } from './simulator';
import { startActivityHeartbeat } from '../activity-heartbeat';

// Tipifica corre en un iframe: sus eventos de ratón y teclado no llegan a la página principal, así que avisa por su cuenta.
startActivityHeartbeat();

mountSimulator(document.querySelector<HTMLElement>('#app')!);
