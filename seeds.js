// seeds.js — Precarga editable: el modelo estándar de un campo de cría extensivo, alineado a SENASA.
// Fuente: conocimiento/MODELO_ESTANDAR.md (I+D, vuelta 2).
// Regla madre: CATEGORÍA = qué animal es (SENASA, no cambia por moverlo). RODEO = con quién está y para qué se maneja.
// CUT, Vacías y Mamones son rodeos, no categorías.
// Nada de esto es fijo: todo se puede renombrar, desactivar o agregar desde Más → Rodeos y categorías.
// Este archivo es público (repositorio): NO lleva datos del campo (empresa, RENSPA, CUIT, stock).
// Esos datos entran con el archivo de arranque privado (Más → Backup → Importar).

// Categorías SENASA con sexo (H/M/?). senasa = categoría oficial equivalente; bovino = entra en los totales SENASA.
export const CATEGORIAS_INICIALES = [
  // id,            nombre,                     sexo, senasa,        cuentaComoVaca, activa, bovino
  ['c-vaca',        'Vaca',                      'H', 'vaca',         true,  true,  true],
  ['c-vaquillona',  'Vaquillona',                'H', 'vaquillona',   false, true,  true],
  ['c-ternero-ss',  'Terneros al pie sin sexar', '?', 'ternero/a',    false, true,  true],
  ['c-ternero',     'Ternero',                   'M', 'ternero',      false, true,  true],
  ['c-ternera',     'Ternera',                   'H', 'ternera',      false, true,  true],
  ['c-torito',      'Torito',                    'M', 'torito',       false, true,  true],
  ['c-toro',        'Toro',                      'M', 'toro',         false, true,  true],
  ['c-novillito',   'Novillito',                 'M', 'novillito',    false, false, true],
  ['c-novillo',     'Novillo',                   'M', 'novillo',      false, false, true],
  ['c-caballo',     'Caballos',                  '',  '',             false, false, false],
].map(([id, nombre, sexo, senasa, cuentaComoVaca, activa, bovino], i) => ({ id, nombre, orden: i + 1, activa, cuentaComoVaca, senasa, sexo, bovino }));

// Rodeos de manejo (plantilla genérica, sin potreros). "esperadas" = categorías que suelen estar ahí:
// solo ordena y destaca casillas; nunca bloquea cargar otra.
const CRIA = ['c-vaca', 'c-vaquillona', 'c-ternero-ss', 'c-ternero', 'c-ternera', 'c-toro'];
export const RODEOS_INICIALES = [
  ['r-cabeza',  'Cabeza',                      CRIA],
  ['r-cuerpo',  'Cuerpo',                      CRIA],
  ['r-cola',    'Cola',                        CRIA],
  ['r-insem',   'Inseminación',                ['c-vaca', 'c-vaquillona']],
  ['r-vaqrepo', 'Vaquillonas de reposición',   ['c-ternera', 'c-vaquillona']],
  ['r-vaqserv', 'Vaquillonas en servicio',     ['c-vaquillona', 'c-vaca', 'c-ternero-ss', 'c-ternero', 'c-ternera', 'c-toro']],
  ['r-cut',     'CUT',                         ['c-vaca', 'c-ternero-ss', 'c-ternero', 'c-ternera']],
  ['r-vacias',  'Vacías',                      ['c-vaca', 'c-vaquillona']],
  ['r-mamones', 'Mamones',                     ['c-ternero', 'c-ternera']],
  ['r-toros',   'Toros',                       ['c-toro', 'c-torito']],
  ['r-toritos', 'Toritos',                     ['c-ternero', 'c-torito']],
  ['r-caballada', 'Caballada',                 ['c-caballo']],
].map(([id, nombre, esperadas], i) => ({ id, nombre, ubicacion: '', orden: i + 1, activo: id !== 'r-caballada', esperadas }));

// Parámetros: todo lo "a confirmar" queda acá, editable, nunca en el código.
// Calendario por defecto: parición jul–sep (dato del usuario) y el estándar de cría derivado (MODELO_ESTANDAR §4).
// No genera tareas: solo da contexto en los atajos.
export const PARAMETROS_INICIALES = {
  empresa: '',
  campo: 'Mi campo',
  localidad: '',
  renspa: '',
  cuit: '',
  mostrarCuitEnInforme: false,
  vacasDeclaradas: '',
  paricionDesde: '01/07',
  paricionHasta: '30/09',
  servicio: '20/09 al 20/12',
  inseminacion: '20/09 al 10/10',
  tacto: 'febrero a marzo',
  destete: 'marzo a abril',
  yerra: 'octubre a noviembre',
  paseTerneros: 'julio',
  paseToro: 'septiembre',
  entoreVaquillonas: '',          // 15 o 27 meses: lo decide el campo
  porcentajeToros: '3',
  queEsEnfrente: '',
  potreros: '',
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

// Atajos de carga (MODELO_ESTANDAR §3). Cada atajo es una plantilla de filas: de qué categoría sale (catO),
// a qué categoría pasa (cat) y, si es fijo, a qué rodeo va (rodeo). Las filas sin rodeo fijo van al rodeo
// elegido en los botones "¿Quedan en qué rodeo?" (rodeosDestino; el primero que exista es el sugerido, y
// 'mismo' = el mismo rodeo de origen). Si catO === cat, el renglón es un TRASLADO (la categoría no cambia).
// Si falta o está desactivada una categoría o un rodeo de una fila, esa fila no aparece. Nada fijo en el código.
export const ATAJOS = [
  { id: 'sexado', nombre: 'Sexado (yerra)', ayuda: 'Sin sexar → Ternero / Ternera', cuando: 'yerra',
    filas: [{ catO: 'c-ternero-ss', cat: 'c-ternero' }, { catO: 'c-ternero-ss', cat: 'c-ternera' }], rodeosDestino: ['mismo'] },
  { id: 'destete', nombre: 'Destete', ayuda: 'Terneros al rodeo de destete', cuando: 'destete',
    filas: [{ catO: 'c-ternero', cat: 'c-ternero' }, { catO: 'c-ternera', cat: 'c-ternera' }, { catO: 'c-ternero-ss', cat: 'c-ternero-ss' }],
    rodeosDestino: ['r-mamones', 'r-destetados'] },
  { id: 'tacto', nombre: 'Tacto', ayuda: 'Vacías y CUT a su rodeo', cuando: 'tacto',
    filas: [{ catO: 'c-vaca', cat: 'c-vaca', rodeo: 'r-vacias', texto: 'Vacas vacías (al rodeo Vacías)' },
      { catO: 'c-vaca', cat: 'c-vaca', rodeo: 'r-cut', texto: 'Vacas CUT (al rodeo CUT)' },
      { catO: 'c-vaquillona', cat: 'c-vaquillona', rodeo: 'r-vacias', texto: 'Vaquillonas vacías (al rodeo Vacías)' }],
    rodeosDestino: [] },
  { id: 'primer-parto', nombre: 'Primer parto', ayuda: 'Vaquillona → Vaca', cuando: 'paricion',
    filas: [{ catO: 'c-vaquillona', cat: 'c-vaca' }], rodeosDestino: ['mismo'] },
  { id: 'pase-terneros', nombre: 'Pase de terneros', ayuda: 'Ternera → Vaquillona · Ternero → Torito', cuando: 'paseTerneros',
    filas: [{ catO: 'c-ternera', cat: 'c-vaquillona', rodeo: 'r-vaqrepo', texto: 'Terneras → Vaquillonas (a Vaquillonas de reposición)' },
      { catO: 'c-ternero', cat: 'c-torito', rodeo: 'r-toritos', texto: 'Terneros → Toritos (a Toritos)' },
      { catO: 'c-ternero', cat: 'c-novillito', texto: 'Terneros castrados → Novillitos' }],
    rodeosDestino: ['mismo'] },
  { id: 'pase-toro', nombre: 'Pase a toro', ayuda: 'Torito → Toro', cuando: 'paseToro',
    filas: [{ catO: 'c-torito', cat: 'c-toro' }], rodeosDestino: ['mismo', 'r-toros'] },
];

// Categorías que pueden nacer (nacimiento): el cursor va a "sin sexar".
export const NACEN = ['c-ternero-ss', 'c-ternero', 'c-ternera'];

// Destino más probable en un cambio de categoría común (para poner el cursor ahí y ahorrar un toque).
export const DESTINO_PROBABLE = { 'c-vaquillona': 'c-vaca', 'c-ternera': 'c-vaquillona', 'c-ternero': 'c-torito', 'c-torito': 'c-toro', 'c-ternero-ss': 'c-ternero' };

// ---- Migración desde la v0.3 (categorías copiadas de las columnas del papel) ----
// Categoría vieja → categoría SENASA. No se reescribe la historia: se agregan renglones de reclasificación
// con fecha de hoy y motivo, y la categoría vieja queda desactivada (los movimientos viejos la siguen nombrando).
export const MAPEO_V03 = {
  'c-vacas': 'c-vaca',
  'c-terneros': 'c-ternero-ss',
  'c-padres': 'c-toro',
  'c-toritos': 'c-torito',
  'c-cut': 'c-vaca',
  'c-mamonesm': 'c-ternero',
  'c-mamonesh': 'c-ternera',
  'c-vaquillonas': 'c-vaquillona',
  'c-caballos': 'c-caballo',
};
// Categorías esperadas para los rodeos que traía la v0.3 (por identificador).
export const ESPERADAS_V03 = {
  'r-cola': CRIA, 'r-cuerpo': CRIA, 'r-cabeza': CRIA, 'r-cuerpo2': CRIA, 'r-coloradas': CRIA, 'r-coloradas2': CRIA,
  'r-vaqotono': ['c-vaquillona', 'c-vaca', 'c-ternero', 'c-ternera', 'c-ternero-ss'],
  'r-recrianegras': ['c-ternera', 'c-vaquillona'], 'r-recriacoloradas': ['c-ternera', 'c-vaquillona'],
  'r-cut': ['c-vaca', 'c-ternero-ss', 'c-ternero', 'c-ternera'], 'r-vacias': ['c-vaca', 'c-vaquillona'],
  'r-destetados': ['c-ternero', 'c-ternera'], 'r-toros': ['c-toro', 'c-torito'],
  'r-insemnegras': ['c-vaca', 'c-vaquillona'], 'r-insemcoloradas': ['c-vaca', 'c-vaquillona'],
};
