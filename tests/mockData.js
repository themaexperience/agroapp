// tests/mockData.js
// Establecimiento ficticio en RAM: "Campo Ficticio El Ombú — 850 ha"
// 100% en memoria para pruebas de sandbox sin red ni persistencia externa

export function createOmbuMockData() {
  const potreros = [
    {
      id: 1,
      numero: 1,
      nombre: 'P1 Loma',
      hectareas: 120,
      estado: 'En pastoreo',
      tipo_uso: 'Pastura natural',
      color: '#10b981',
      coordenadas: [
        [-36.005, -59.005],
        [-36.005, -59.015],
        [-36.015, -59.015],
        [-36.015, -59.005]
      ]
    },
    {
      id: 2,
      numero: 2,
      nombre: 'P2 Bajo',
      hectareas: 200,
      estado: 'Disponible',
      tipo_uso: 'Bajo dulce',
      color: '#3b82f6',
      coordenadas: [
        [-36.015, -59.005],
        [-36.015, -59.025],
        [-36.028, -59.025],
        [-36.028, -59.005]
      ]
    },
    {
      id: 3,
      numero: 3,
      nombre: 'P3 Alfalfa',
      hectareas: 80,
      estado: 'En pastoreo',
      tipo_uso: 'Verdeo / Alfalfa',
      color: '#8b5cf6',
      coordenadas: [
        [-36.005, -59.015],
        [-36.005, -59.030],
        [-36.015, -59.030],
        [-36.015, -59.015]
      ]
    },
    {
      id: 4,
      numero: 4,
      nombre: 'P4 Monte',
      hectareas: 150,
      estado: 'Reserva',
      tipo_uso: 'Monte / Refugio',
      color: '#64748b',
      coordenadas: [
        [-36.028, -59.010],
        [-36.028, -59.035],
        [-36.040, -59.035],
        [-36.040, -59.010]
      ]
    }
  ];

  const infraestructura = [
    { id: 1, potrero_numero: 1, tipo: 'Molino', nombre: 'Molino Principal', latitud: -36.01, longitud: -59.01, estado: 'Operativo' },
    { id: 2, potrero_numero: 2, tipo: 'Molino', nombre: 'Molino Bajo', latitud: -36.02, longitud: -59.02, estado: 'Operativo' },
    { id: 3, potrero_numero: 1, tipo: 'Tranquera', nombre: 'Tranquera Entrada', latitud: -36.008, longitud: -59.008, estado: 'Operativo' },
    { id: 4, potrero_numero: 2, tipo: 'Tranquera', nombre: 'Tranquera Callejón', latitud: -36.018, longitud: -59.018, estado: 'Operativo' },
    { id: 5, potrero_numero: 4, tipo: 'Tranquera', nombre: 'Tranquera Monte', latitud: -36.032, longitud: -59.022, estado: 'Operativo' },
    { id: 6, potrero_numero: 1, tipo: 'Manga / Corrales', nombre: 'Manga y Corrales Centrales', latitud: -36.012, longitud: -59.012, estado: 'Operativo' }
  ];

  const rodeos = [
    {
      id: 1,
      nombre: 'RODEO VACAS CRÍA',
      potrero_numero: 1,
      vacas: 180,
      terneros: 0,
      terneros_machos: 0,
      terneros_hembras: 0,
      toros_padres: 0,
      toritos: 0,
      vacas_cut: 0,
      vaquillonas_reposicion: 0,
      total_cabezas: 180
    },
    {
      id: 2,
      nombre: 'RODEO DESTETADOS',
      potrero_numero: 3,
      vacas: 0,
      terneros: 140,
      terneros_machos: 70,
      terneros_hembras: 70,
      toros_padres: 0,
      toritos: 0,
      vacas_cut: 0,
      vaquillonas_reposicion: 0,
      total_cabezas: 140
    }
  ];

  // 1 caja de 500 caravanas: 320 puestas + 150 en stock + 20 salidas + 10 mermas = 500
  const cajasCaravanas = [
    {
      id: 1,
      caja_numero: 1,
      marca: 'Allflex Oficial SENASA',
      fecha_compra: '2026-06-01',
      desde: '032010008000000',
      hasta: '032010008000499',
      cantidad: 500,
      puestas: 320,
      en_stock: 150,
      salidas: 20,
      mermas: 10,
      usadas: 320,
      usadas_sin_detalle: 0,
      color_tipo: 'Amarilla Oficial SENASA',
      cuig: 'JS307',
      proveedor: 'SIGSA / Allflex Oficial',
      observaciones: 'Caja Ficticia El Ombú: 320 puestas + 150 stock + 20 salidas + 10 mermas = 500'
    }
  ];

  const animales = [];
  const makeId = (n) => '032010008' + String(n).padStart(6, '0');

  // 180 vacas activas en RODEO VACAS CRÍA
  for (let i = 0; i < 180; i++) {
    animales.push({
      id: `ani_${i}`,
      caravana: makeId(i),
      marca: 'El Ombú (JS307)',
      categoria: 'Vaca Cría',
      rodeo: 'RODEO VACAS CRÍA',
      potrero_actual: 1,
      estado: 'Activa en Campo',
      estado_caravana: 'Activa en Campo',
      fecha_colocacion: '2026-06-05'
    });
  }

  // 140 terneros activos en RODEO DESTETADOS
  for (let i = 180; i < 320; i++) {
    animales.push({
      id: `ani_${i}`,
      caravana: makeId(i),
      marca: 'El Ombú (JS307)',
      categoria: 'Ternero Destete',
      rodeo: 'RODEO DESTETADOS',
      potrero_actual: 3,
      estado: 'Activa en Campo',
      estado_caravana: 'Activa en Campo',
      fecha_colocacion: '2026-06-10'
    });
  }

  // 150 en depósito (stock)
  for (let i = 320; i < 470; i++) {
    animales.push({
      id: `ani_${i}`,
      caravana: makeId(i),
      marca: 'El Ombú (JS307)',
      categoria: 'Sin asignar (En depósito)',
      rodeo: null,
      potrero_actual: null,
      estado: 'En Stock',
      estado_caravana: 'En Stock'
    });
  }

  // 20 salidas comerciales
  for (let i = 470; i < 490; i++) {
    animales.push({
      id: `ani_${i}`,
      caravana: makeId(i),
      marca: 'El Ombú (JS307)',
      categoria: 'Venta',
      rodeo: 'SALIDA / DESPACHO',
      potrero_actual: null,
      estado: 'Salida / Vendida',
      estado_caravana: 'Salida / Vendida',
      motivo_salida: 'Venta Directa',
      fecha_salida: '2026-07-15'
    });
  }

  // 10 mermas / roturas
  for (let i = 490; i < 500; i++) {
    animales.push({
      id: `ani_${i}`,
      caravana: makeId(i),
      marca: 'El Ombú (JS307)',
      categoria: 'Baja',
      rodeo: 'MERMA / ROTURA',
      potrero_actual: null,
      estado: 'Baja / Merma',
      estado_caravana: 'Merma',
      motivo_salida: 'Rotura de fábrica en colocación',
      fecha_salida: '2026-06-15'
    });
  }

  const siembras = [
    {
      id: 1,
      potrero_numero: 3,
      cultivo_variedad: 'Avena / Raigrás 2026',
      tipo: 'Siembra',
      fecha: '2026-04-15',
      hectareas: 80,
      estado: 'Emergido',
      costo_total_usd: 4800,
      insumos: [
        { tipo: 'Semilla', producto: 'Avena Blanca', dosis: '80 kg/ha', cantidad: 6400, subtotal: 3200 },
        { tipo: 'Fertilizante', producto: 'Fosfato Diamónico', dosis: '50 kg/ha', cantidad: 4000, subtotal: 1600 }
      ]
    }
  ];

  // 2 proveedores agendados en la misma semana
  const proveedoresEsperados = [
    {
      id: 1,
      proveedor_o_rubro: 'Semillas del Sur',
      producto: 'Semillas Sorgo Forrajero',
      fecha_esperada: '2026-11-25',
      fecha_fin: '2026-11-29',
      estado: 'Pendiente',
      indicaciones: 'Entregar en galpón del casco principal',
      notas: 'Coordinar con tractorista para descarga con autoelevador'
    },
    {
      id: 2,
      proveedor_o_rubro: 'Veterinaria San Antonio',
      producto: 'Vacunas y Carminativo',
      fecha_esperada: '2026-11-26',
      fecha_fin: '2026-11-28',
      estado: 'Pendiente',
      indicaciones: 'Mantener cadena de frío 2-8°C en heladera',
      notas: 'Revisar fecha de vencimiento lote biológico'
    }
  ];

  return {
    potreros,
    infraestructura,
    rodeos,
    cajasCaravanas,
    animales,
    siembras,
    proveedoresEsperados,
    movimientosHacienda: [],
    eventosSanitarios: [],
    bitacoraNotas: [],
    gastosCampo: [],
    ventasHacienda: [],
    maquinaria: [],
    maquinariaRepuestos: [],
    maquinariaServices: [],
    campanasKpis: [],
    stockInsumos: [],
    movimientosInsumos: [],
    registrosLluvias: [],
    balancesContables: []
  };
}
