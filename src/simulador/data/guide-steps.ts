// Guía paso a paso de Control Next. Cada paso resalta una zona marcada con `data-sim-guide="<id>"`.
// Los textos explican el aplicativo tal como se usa en la operación; los datos de la práctica son ficticios.

export type GuideView = 'login' | 'carteras' | 'clientes' | 'ficha';

export interface GuideStep {
  /** Zona a resaltar; sin ella el paso se muestra centrado. */
  target?: string;
  title: string;
  text: string;
  /** Botón extra al final del paso (p. ej. lanzar la demostración de búsqueda por cédula). */
  action?: { label: string; run: 'demo-cedula' | 'demo-pausa' | 'prueba' };
}

export const GUIDE_STEPS: Record<GuideView, GuideStep[]> = {
  login: [
    {
      title: 'Bienvenido a Control Next',
      text: 'Control Next es el aplicativo de gestión de cobranzas con el que trabajarás todos los días: ahí ves tus campañas, buscas a cada cliente, registras lo que pasó en la llamada (la tipificación) y consultas su histórico. Esta es una copia de práctica: los clientes son ficticios y nada sale de tu navegador.',
    },
    {
      target: 'login.formulario',
      title: 'Iniciar sesión',
      text: 'En la operación ingresas con tu documento y la contraseña que te asignen. Es personal: nunca la compartas ni dejes la sesión abierta si te levantas del puesto.',
    },
    {
      target: 'login.credenciales',
      title: 'Credenciales de práctica',
      text: 'Para practicar pulsa «Usar credenciales de práctica» y luego «Ingresar al simulador».',
    },
  ],
  carteras: [
    {
      target: 'carteras.encabezado',
      title: 'Encabezado',
      text: 'Arriba a la izquierda está el logo y el menú (☰). Al lado, el reloj con la hora de Bogotá: es la hora con la que queda registrada cada gestión.',
    },
    {
      target: 'carteras.perfil',
      title: 'Tu perfil',
      text: 'Tu nombre, el cargo (Asesor de Cobranzas), el correo, la cédula, tu extensión telefónica y tu teléfono. La extensión es el número con el que la planta telefónica te enruta las llamadas.',
    },
    {
      target: 'carteras.extension',
      title: 'Aviso de extensión',
      text: 'Si aquí aparece «Extensión inválida», avisa a tu supervisor antes de empezar: sin una extensión válida no puedes llamar.',
    },
    {
      target: 'comun.avatar',
      title: 'Tu avatar',
      text: 'En tu foto (arriba a la derecha) está el menú del asesor: «Mi Perfil» vuelve a esta pantalla, «Pausa» inicia una pausa y «Logout» cierra la sesión.',
    },
    {
      target: 'carteras.listado',
      title: 'Campañas',
      text: 'Cada tarjeta es una campaña (cartera) que tienes asignada. En la práctica las campañas tienen nombres ficticios. Escoge una campaña para continuar: pulsa «Aurora» para entrar a sus clientes.',
    },
  ],
  clientes: [
    {
      target: 'comun.barra-lateral',
      title: 'Menú lateral',
      text: 'Con ☰ se despliega el menú con tu foto y tu nombre. Nosotros solo usamos cuatro opciones: «Main» (tu perfil y tus campañas), «Dashboard» (las cifras de la campaña), «Productividad» (tus gestiones por día) y «Clientes» (donde gestionas). «Adm. Pausas» es una opción adicional que no es de nuestro uso: ignórala.',
    },
    {
      target: 'comun.reloj',
      title: 'Hora de la operación',
      text: 'La misma hora de Bogotá del Dashboard. Úsala para cumplir los horarios de llamada permitidos.',
    },
    {
      target: 'comun.estado-conexion',
      title: 'Extensión y estado',
      text: 'Tu extensión y tu estado: CONECTADO significa que puedes hacer y recibir llamadas; EN PAUSA, que no te entran llamadas. Durante una llamada aquí aparece «En llamada» con el botón «Colgar».',
    },
    {
      target: 'clientes.herramientas',
      title: 'Herramientas',
      text: 'Lista de tareas (tus agendamientos), campana de avisos (promesas que vencen hoy y clientes sin gestión), pagos ($) y la lupa para buscar a un cliente.',
    },
    {
      target: 'comun.avatar',
      title: 'Pausas (almuerzo, break, baño…)',
      text: 'Cada vez que te levantes del puesto haz una pausa: 1) si estás en llamada, termínala primero con «Colgar» y guarda la gestión; 2) pulsa tu avatar y elige «Pausa»; 3) selecciona el tipo (BREAK AM, ALMUERZO, BREAK PM, BAÑO, CAPACITACIÓN…) y pulsa «Enviar»; 4) al volver pulsa «Continuar». Nunca dejes el puesto sin pausar.',
      action: { label: 'Ver cómo se hace una pausa', run: 'demo-pausa' },
    },
    {
      target: 'clientes.pestanas',
      title: 'Archivos y Clientes',
      text: '«Archivos» es la asignación de la campaña y «Clientes» el listado para gestionar. Cuando abres un cliente aparece una pestaña «G.C - cédula» (gestión del cliente) que puedes cerrar con la ×.',
    },
    {
      target: 'clientes.campos',
      title: 'Filtros',
      text: 'Filtra por fecha de promesa, fecha de gestión, ciudad, asesor, mejor perfil y último perfil, y elige cómo ordenar. Así armas tu lista de trabajo del día.',
    },
    {
      target: 'clientes.semaforo',
      title: 'Estado de Gestión de Cartera',
      text: 'El semáforo: cian = sin gestión, amarillo = menos de 5 días sin gestión, rojo = más de 5 días sin gestión, verde = gestionado hoy. Pulsa un color para ver solo esos clientes. Prioriza los rojos y los cian.',
    },
    {
      target: 'clientes.acciones',
      title: 'Restablecer y Buscar',
      text: '«Restablecer» limpia los filtros y «Buscar» los aplica a la tabla.',
    },
    {
      target: 'clientes.tabla',
      title: 'Tabla de clientes',
      text: 'Identificación, nombre, mejor perfil (el mejor resultado que se ha logrado con el cliente), último perfil (el resultado de la última gestión), asesor, fecha de gestión y total de promesas. El punto de color es su semáforo. Pulsa una fila para abrir la ficha.',
    },
    {
      target: 'comun.buscar',
      title: 'Buscar por cédula',
      text: 'Cuando un cliente te devuelve la llamada o te piden revisar un caso, lo más rápido es la lupa: abre el panel «Buscar» y escribes la cédula. Mira cómo se hace.',
      action: { label: 'Ver cómo se ingresa una cédula', run: 'demo-cedula' },
    },
  ],
  ficha: [
    {
      target: 'ficha.encabezado',
      title: 'Ficha del cliente (G.C)',
      text: 'Arriba ves la campaña, en qué cliente vas de tu lista (1 / 1) y los botones Anterior / Siguiente para pasar al siguiente cliente sin volver a la tabla.',
    },
    {
      target: 'ficha.info',
      title: 'Información Personal',
      text: 'Nombre, identificación, ciudad, fecha de la última gestión, último y mejor perfil, asesor asignado, «Fecha Agendado» (para programar una nueva llamada) y la fecha y el valor del último pago acordado.',
    },
    {
      target: 'ficha.datos',
      title: 'Datos y Adicionales',
      text: 'La obligación: número de cliente, cuenta, edad de cobranza (franja de mora), valor vencido, intereses de mora, saldo total y honorarios. El botón ⓘ muestra las referencias. «Adicionales» trae producto, días de mora y correo. Ten estas cifras a mano antes de negociar.',
    },
    {
      target: 'ficha.tiempo',
      title: 'Tiempo de Gestión',
      text: 'Cuenta horas, minutos y segundos desde que abriste la ficha. Mide cuánto tardas en cada gestión.',
    },
    {
      target: 'ficha.botones',
      title: 'Demográficos, Pagos y Remarcar',
      text: '«Demográficos» muestra y actualiza los datos de contacto. «Pagos» lista lo que el cliente ya pagó: revísalo antes de cobrar. «Remarcar» vuelve a llamar al titular (aquí la llamada es simulada).',
    },
    {
      target: 'ficha.nota',
      title: 'Nueva Gestión de Llamadas',
      text: 'Tipifica todo lo que escuchaste en la llamada: no dejes nada por fuera. Escribe qué pasó, claro y sin abreviar de más. El formato habitual empieza con el teléfono: «3001234567 // TT INDICA QUE…» (TT = titular).',
    },
    {
      target: 'ficha.tipificacion',
      title: 'Tipificar la gestión',
      text: 'Cada campo depende del anterior. 1) Acción: «Hacer Llamada» si marcaste tú o «Recibir Llamada» si te llamaron. 2) Contacto: Directo (el titular), Indirecto (un tercero) o Sin Contacto (solo existe si tú llamaste). 3) Canal: Telefonico, Whatsapp o Correo. 4) Perfil: el resultado; cambia según el contacto (con un tercero nunca hay acuerdo de pago). 5) Motivo No Pago. Si el perfil es un acuerdo pide fecha y valor; si es «Volver a llamar» o «Recordar», cuándo llamar.',
    },
    {
      target: 'ficha.guardar',
      title: 'Buzón, Cancelar y Guardar',
      text: '«Buzón» registra al instante que la llamada cayó a buzón de voz. «Cancelar» limpia el formulario. «Guardar» registra la gestión: si no guardas, para la empresa la llamada no existió.',
    },
    {
      target: 'ficha.historico',
      title: 'Histórico',
      text: 'Todas las gestiones del cliente: fecha y hora, usuario, acción, efecto, contacto, teléfono, el texto de la gestión, los tiempos, el motivo, la promesa y el audio. Léelo siempre antes de llamar para no repetir preguntas ni contradecir a un compañero.',
    },
    {
      title: 'Ahora, tu prueba de tipificación',
      text: 'Ya conoces la ficha. Ahora te haremos una prueba: escucharás 2 llamadas reales de entrenamiento, distintas para cada asesor (entre ellas: titular, tercero, promesa de pago, volver a llamar, pago ya realizado y número equivocado). En cada una verás arriba los checkmarks de lo que debe tener la tipificación; al guardar, el sistema experto revisa lo que elegiste y escribiste y marca qué cumpliste y qué te faltó. Cada ejercicio se presenta una sola vez y su resultado queda guardado. No se aprueba ni se reprueba: recibes retroalimentación de qué puntos coincidieron con la llamada. Tus conocimientos se confirman después en el examen general.',
      action: { label: 'Iniciar la prueba de tipificación', run: 'prueba' },
    },
  ],
};
