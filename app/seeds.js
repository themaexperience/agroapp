// seeds.js — Precarga editable: rodeos y categorías con la forma de la planilla en papel.
// Nada de esto es fijo: todo se puede renombrar, desactivar o agregar desde Más → Rodeos y categorías.
// Este archivo es público (repositorio): NO lleva datos del campo (empresa, RENSPA, CUIT, stock).
// Esos datos entran con el archivo de arranque privado (Más → Backup → Importar).

export const RODEOS_INICIALES = [
  ['r-cola', 'Cola', ''],
  ['r-cuerpo', 'Cuerpo', ''],
  ['r-cabeza', 'Cabeza', ''],
  ['r-cuerpo2', 'Cuerpo 2 (inseminadas)', ''],
  ['r-coloradas', 'Coloradas', ''],
  ['r-vaqotono', 'Vaquillonas otoño', ''],
  ['r-recrianegras', 'Recría negras', 'Enfrente'],
  ['r-recriacoloradas', 'Recría coloradas', ''],
  ['r-cut', 'CUT', 'Enfrente'],
  ['r-vacias', 'Vacías', ''],
  ['r-destetados', 'Destetados', ''],
  ['r-toros', 'Toros', ''],
  ['r-insemnegras', 'Inseminación negras', ''],
  ['r-insemcoloradas', 'Inseminación coloradas', ''],
  ['r-coloradas2', 'Coloradas rodeo 2', ''],
].map(([id, nombre, ubicacion], i) => ({ id, nombre, ubicacion, orden: i + 1, activo: id !== 'r-coloradas2' }));

// Columnas de la planilla papel. "senasa" = equivalencia SENASA (texto libre, sin uso todavía).
export const CATEGORIAS_INICIALES = [
  ['c-vacas', 'Vacas', true, 'vaca'],
  ['c-terneros', 'Terneros', false, 'ternero/a'],
  ['c-padres', 'Padres', false, 'toro'],
  ['c-toritos', 'Toritos', false, 'torito'],
  ['c-cut', 'CUT', false, 'vaca'],
  ['c-mamonesm', 'Mamones machos', false, 'ternero'],
  ['c-mamonesh', 'Mamones hembras', false, 'ternera'],
  ['c-vaquillonas', 'Vaquillonas', false, 'vaquillona'],
  ['c-caballos', 'Caballos', false, ''],
].map(([id, nombre, cuentaComoVaca, senasa], i) => ({ id, nombre, orden: i + 1, activa: id !== 'c-caballos', cuentaComoVaca, senasa }));

// Parámetros: todo lo que el informe marca "a confirmar" queda acá, editable, nunca en el código.
export const PARAMETROS_INICIALES = {
  empresa: '',
  campo: 'Mi campo',
  localidad: '',
  renspa: '',
  cuit: '',
  mostrarCuitEnInforme: false,
  vacasDeclaradas: '',            // cifra oficial: a confirmar
  paricionDesde: '',              // mayo o junio: a confirmar
  paricionHasta: '',              // agosto o septiembre: a confirmar
  porcentajeToros: '',            // 3, 3,5 o 4: a confirmar
  queEsEnfrente: '',
  potreros: '',                   // lista libre: a confirmar
  motivosAjuste: [
    'Error de carga',
    'Error de conteo',
    'Muerte no anotada',
    'Nacimiento no anotado',
    'Traslado no anotado',
    'Cambio de categoría no anotado',
    'Faltante sin explicación',
  ],
};

// Atajos de carga: cambios de categoría típicos de la cría en un solo guardado.
// Cada fila destino dice a qué categoría pasa y, opcionalmente, a qué rodeo va.
// Si una categoría o rodeo no existe o está desactivado, esa fila (o el atajo) no aparece.
export const ATAJOS = [
  { id: 'destete', nombre: 'Destete', ayuda: 'Terneros → Mamones', catO: 'c-terneros',
    filas: [{ cat: 'c-mamonesm' }, { cat: 'c-mamonesh' }], rodeosDestino: ['r-destetados'] },
  { id: 'tacto', nombre: 'Tacto', ayuda: 'Vacas → CUT / Vacías', catO: 'c-vacas',
    filas: [{ cat: 'c-cut', rodeo: 'r-cut', texto: 'CUT (al rodeo CUT)' }, { cat: 'c-vacas', rodeo: 'r-vacias', texto: 'Vacías (al rodeo Vacías)' }], rodeosDestino: [] },
];

// Destino más probable en un cambio de categoría (para poner el cursor ahí y ahorrar un toque).
export const DESTINO_PROBABLE = { 'c-terneros': 'c-mamonesm', 'c-vacas': 'c-cut', 'c-vaquillonas': 'c-vacas', 'c-mamonesh': 'c-vaquillonas', 'c-toritos': 'c-padres' };
