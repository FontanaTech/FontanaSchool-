import './team-welcome.css';
import { escapar } from '../http';

// Pantalla de bienvenida para quien aprueba el examen general: cierra la formación y abre el paso «Trabaja con nosotros».

type Options = { backHref: string; certificateHref?: string };

const MOMENTS = [
  { image: 'bienvenida-momento-01', title: 'Somos un solo equipo', text: 'Cada llamada bien gestionada suma a la de tus compañeros.' },
  { image: 'bienvenida-momento-02', title: 'Aquí te esperamos', text: 'Llegas con las bases claras para empezar con confianza.' },
  { image: 'bienvenida-momento-03', title: 'Aprendemos juntos', text: 'Pregunta, practica y crece con quienes ya recorrieron este camino.' },
] as const;

const picture = (name: string, alt: string, extra = ''): string =>
  `<img src="/imagenes/${name}.png" alt="${escapar(alt)}" width="1086" height="1448" decoding="async"${extra}>`;

export function mountTeamWelcome(container: HTMLElement, { certificateHref = '/induccion/certificado' }: Options): void {
  container.innerHTML = `<section class="team-welcome" aria-labelledby="team-welcome-title">
    <div class="team-welcome-hero">
      <div class="team-welcome-copy">
        <p class="team-welcome-kicker">PASO 03 · TRABAJA CON NOSOTROS</p>
        <h1 id="team-welcome-title" tabindex="-1">Te damos la bienvenida al equipo Fontana</h1>
        <p class="team-welcome-lead">Aprobaste el examen general. Recorriste la empresa, la cobranza, la objeción y Control Next: ya estás listo para empezar a trabajar con nosotros.</p>
        <ul class="team-welcome-wins" aria-label="Lo que lograste">
          <li><span aria-hidden="true">✓</span>Completaste los cuatro módulos de formación</li>
          <li><span aria-hidden="true">✓</span>Aprobaste el examen general</li>
          <li><span aria-hidden="true">✓</span>Tu certificado de Fontana School está listo</li>
        </ul>
        <div class="team-welcome-actions">
          <a class="team-welcome-primary" href="${escapar(certificateHref)}">Ver mi certificado →</a>
        </div>
      </div>
      <figure class="team-welcome-hero-image"><img src="/imagenes/bienvenida-equipo-samuel.png" alt="Equipo de Fontana durante una jornada de trabajo" width="768" height="1024" decoding="async"></figure>
    </div>
    <ul class="team-welcome-moments">
      ${MOMENTS.map((moment) => `<li><figure>${picture(moment.image, moment.title, ' loading="lazy"')}</figure><div><h2>${escapar(moment.title)}</h2><p>${escapar(moment.text)}</p></div></li>`).join('')}
    </ul>
    <aside class="team-welcome-next"><div><h2>¿Y ahora qué sigue?</h2><p>Descarga tu certificado y comparte la noticia. Pronto conocerás a tu equipo y empezarás a poner en práctica todo lo aprendido.</p></div></aside>
  </section>`;
  container.querySelector<HTMLElement>('#team-welcome-title')?.focus({ preventScroll: true });
}
