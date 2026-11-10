import './hr-admin.css';
import { api, escapar, formatDate } from '../http';

// Panel «Recursos humanos» (#recursos-humanos): asesores que ya completaron sus datos personales, filtrados por la
// fecha en que los registraron. Se seleccionan los que se necesiten y se exporta un Excel que el navegador (o la
// aplicación de escritorio) deja en la carpeta Descargas del equipo.

type Helpers = {
  feedback(message: string, error?: boolean): void;
  empty(columns: number, message?: string): string;
};

type Profile = {
  id: string; nombre: string; apellidos: string; nombreCompleto: string; tipoDocumento: string; numeroDocumento: string;
  fechaNacimiento: string | null; sexo: string; tipoSangre: string; tallaCamisa: string; correo: string; telefono: string;
  direccionResidencia: string; nombreContactoEmergencia: string; numeroContactoEmergencia: string; banco: string; numeroCuenta: string;
  experiencia: boolean | null; estado: string; fechaDatosCompletados: string | null; fechaCreacion: string;
};

const ESTADOS: Record<string, string> = { activo: 'Activo', inactivo: 'Inactivo', bloqueado: 'Bloqueado' };
const COLUMNS = 12;

// Filtros y selección sobreviven a los repintados en vivo del panel.
const state = { from: '', to: '', q: '', selected: new Set<string>() };

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const birthDate = (value: string | null): string => (value ? value.split('-').reverse().join('/') : '—');
const pretty = (value: string): string => value.split('-').reverse().join('/');

function rowHtml(profile: Profile): string {
  const selected = state.selected.has(profile.id);
  const name = `${profile.nombre} ${profile.apellidos}`.trim() || profile.nombreCompleto;
  return `<tr data-row="${profile.id}"${selected ? ' class="is-selected"' : ''}>
    <td><input type="checkbox" data-id="${profile.id}"${selected ? ' checked' : ''} aria-label="Seleccionar a ${escapar(name)}"></td>
    <td><strong>${escapar(name)}</strong><small>${escapar(profile.tipoDocumento)} ${escapar(profile.numeroDocumento)}</small></td>
    <td>${birthDate(profile.fechaNacimiento)}</td>
    <td>${escapar(profile.sexo) || '—'}</td>
    <td>${escapar(profile.tipoSangre) || '—'}</td>
    <td>${escapar(profile.tallaCamisa) || '—'}</td>
    <td>${escapar(profile.correo) || '—'}<small>${escapar(profile.telefono) || 'Sin teléfono'}</small></td>
    <td>${escapar(profile.direccionResidencia) || '—'}</td>
    <td>${escapar(profile.nombreContactoEmergencia) || '—'}<small>${escapar(profile.numeroContactoEmergencia)}</small></td>
    <td>${escapar(profile.banco) || '—'}<small>${escapar(profile.numeroCuenta)}</small></td>
    <td>${formatDate(profile.fechaDatosCompletados)}</td>
    <td>${escapar(ESTADOS[profile.estado] ?? profile.estado)}</td>
  </tr>`;
}

function summaryText(count: number): string {
  const range = state.from && state.to && state.from === state.to ? `registrados el ${pretty(state.from)}`
    : state.from && state.to ? `registrados del ${pretty(state.from)} al ${pretty(state.to)}`
      : state.from ? `registrados desde el ${pretty(state.from)}`
        : state.to ? `registrados hasta el ${pretty(state.to)}` : 'con los datos completos';
  return `${count} asesor${count === 1 ? '' : 'es'} ${range}${state.q ? ` que coinciden con «${state.q}»` : ''}.`;
}

export async function hrSection(view: HTMLElement, helpers: Helpers): Promise<void> {
  const query = new URLSearchParams();
  if (state.from) query.set('from', state.from);
  if (state.to) query.set('to', state.to);
  if (state.q) query.set('q', state.q);
  const { data } = await api<{ data: Profile[] }>(`/admin/hr/profiles?${query}`);
  // La selección solo incluye filas visibles con el filtro actual.
  const visible = new Set(data.map((profile) => profile.id));
  for (const id of state.selected) if (!visible.has(id)) state.selected.delete(id);

  view.innerHTML = `<section class="auth-card admin-card hr-panel">
    <div class="section-title"><div><h2>Recursos humanos</h2><p>Asesores que ya completaron sus datos personales. Filtra por la fecha en que los registraron, selecciona los que necesites y genera el Excel: queda en la carpeta Descargas del equipo.</p></div></div>
    <form id="hr-filter" class="filter-grid">
      <label class="inline-label">Desde<input type="date" name="from" value="${escapar(state.from)}"></label>
      <label class="inline-label">Hasta<input type="date" name="to" value="${escapar(state.to)}"></label>
      <input name="q" placeholder="Nombre o documento" aria-label="Buscar por nombre o documento" value="${escapar(state.q)}">
      <button type="submit">Filtrar</button>
      <button type="button" data-today>Registrados hoy</button>
      <button type="button" data-clear>Ver todos</button>
    </form>
    <p class="hr-summary" data-summary>${escapar(summaryText(data.length))}</p>
    <div class="hr-toolbar">
      <label><input type="checkbox" data-select-all${data.length && state.selected.size === data.length ? ' checked' : ''}${data.length ? '' : ' disabled'}>Seleccionar todos los de la lista</label>
      <span class="hr-count" data-count></span>
      <button type="button" class="primary-action hr-export" data-export>Exportar a Excel</button>
    </div>
    <div class="table-wrap hr-table"><table>
      <thead><tr><th></th><th>Asesor</th><th>Nacimiento</th><th>Sexo</th><th>Sangre</th><th>Talla</th><th>Correo y teléfono</th><th>Dirección</th><th>Contacto de emergencia</th><th>Banco y cuenta</th><th>Datos registrados</th><th>Estado</th></tr></thead>
      <tbody>${data.length ? data.map(rowHtml).join('') : helpers.empty(COLUMNS, 'Ningún asesor con datos completos para este filtro.')}</tbody>
    </table></div>
  </section>`;

  const exportButton = view.querySelector<HTMLButtonElement>('[data-export]')!;
  const selectAll = view.querySelector<HTMLInputElement>('[data-select-all]')!;
  const count = view.querySelector<HTMLElement>('[data-count]')!;
  const refreshSelection = (): void => {
    const total = state.selected.size;
    count.textContent = total ? `${total} seleccionado${total === 1 ? '' : 's'}` : 'Ninguno seleccionado';
    exportButton.disabled = total === 0;
    exportButton.textContent = total ? `Exportar a Excel (${total})` : 'Exportar a Excel';
    selectAll.checked = data.length > 0 && total === data.length;
    selectAll.indeterminate = total > 0 && total < data.length;
  };
  refreshSelection();

  view.querySelectorAll<HTMLInputElement>('input[data-id]').forEach((box) => box.addEventListener('change', () => {
    if (box.checked) state.selected.add(box.dataset.id!); else state.selected.delete(box.dataset.id!);
    box.closest('tr')?.classList.toggle('is-selected', box.checked);
    refreshSelection();
  }));
  selectAll.addEventListener('change', () => {
    for (const profile of data) { if (selectAll.checked) state.selected.add(profile.id); else state.selected.delete(profile.id); }
    view.querySelectorAll<HTMLInputElement>('input[data-id]').forEach((box) => { box.checked = selectAll.checked; box.closest('tr')?.classList.toggle('is-selected', selectAll.checked); });
    refreshSelection();
  });

  const rerender = (): void => { void hrSection(view, helpers).catch((error) => helpers.feedback((error as Error).message, true)); };
  view.querySelector<HTMLFormElement>('#hr-filter')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    state.from = String(form.get('from') ?? '');
    state.to = String(form.get('to') ?? '');
    state.q = String(form.get('q') ?? '').trim();
    rerender();
  });
  view.querySelector('[data-today]')!.addEventListener('click', () => { state.from = today(); state.to = state.from; rerender(); });
  view.querySelector('[data-clear]')!.addEventListener('click', () => { state.from = ''; state.to = ''; state.q = ''; rerender(); });

  exportButton.addEventListener('click', async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    exportButton.disabled = true;
    exportButton.textContent = 'Generando el Excel…';
    try {
      const filename = await downloadExcel(ids);
      helpers.feedback(`Excel generado: ${filename} (${ids.length} asesor${ids.length === 1 ? '' : 'es'}). Quedó en la carpeta Descargas del equipo.`);
    } catch (error) {
      helpers.feedback((error as Error).message, true);
    } finally {
      refreshSelection();
    }
  });
}

// Pide el libro al servidor y lo entrega al navegador como descarga. En la aplicación de escritorio, la descarga
// se guarda directamente en la carpeta Descargas; en el navegador, en su carpeta de descargas predeterminada.
async function downloadExcel(ids: string[]): Promise<string> {
  const response = await fetch('/api/admin/hr/export', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  if (response.status === 401) { location.assign('/login'); throw new Error('Tu sesión venció. Inicia sesión nuevamente.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? 'No se pudo generar el Excel.');
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Fontana-asesores-datos.xlsx';
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}
