// excel-backup.js — Convierte las hojas leídas de un .xlsx exportado por esta app en un backup.
// Script clásico: lo usan el worker de Excel (importScripts) y, si el worker no anda, la propia página.
(function () {
  function errorUsuario(msg) { const e = new Error(msg); e.usuario = true; return e; }
  function excelHojasABackup(hojas) {
    const porNombre = Object.fromEntries(hojas.map((h) => [h.sheet, h.data]));
    const objs = (nombre) => {
      const d = porNombre[nombre]; if (!d) throw errorUsuario(`Falta la hoja "${nombre}": no parece un Excel exportado por esta app.`);
      const [cab, ...filas] = d;
      // Si una columna aparece dos veces (legible y técnica con el mismo nombre), gana la técnica (la última).
      return filas.map((f) => { const o = {}; cab.forEach((c, i) => { o[c] = f[i] ?? ''; }); return o; });
    };
    const s = (v) => (v === null || v === undefined ? '' : String(v));
    const n = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
    const ctrl = Object.fromEntries(objs('Control').map((o) => [o.clave, o.valor]));
    const movimientos = objs('Movimientos').map((o) => ({
      id: s(o.id), fecha: s(o.fecha), tipo: s(o.tipo), cantidad: n(o.cantidad),
      origen: o.origen_rodeo_id ? { rodeoId: s(o.origen_rodeo_id), categoriaId: s(o.origen_categoria_id) } : null,
      destino: o.destino_rodeo_id ? { rodeoId: s(o.destino_rodeo_id), categoriaId: s(o.destino_categoria_id) } : null,
      nota: s(o.nota), caravana: s(o.caravana), motivo: s(o.motivo), conteoId: s(o.conteo_id) || null, lote: s(o.lote) || null, creado: s(o.creado),
      anulado: o.anulado_fecha ? { fecha: s(o.anulado_fecha), motivo: s(o.anulado_motivo) } : null, corrigeA: s(o.corrige_a) || null,
      antes: o.antes_json ? JSON.parse(s(o.antes_json)) : null,
      extra: o.extra_json ? JSON.parse(s(o.extra_json)) : {},
    }));
    const conteos = objs('Conteos').map((o) => {
      const c = { id: s(o.id), fecha: s(o.fecha), rodeoId: s(o.rodeo_id), categoriaId: s(o.categoria_id), cantidad: n(o.cantidad), origen: s(o.origen), nota: s(o.nota), creado: s(o.creado), anulado: o.anulado_fecha ? { fecha: s(o.anulado_fecha), motivo: s(o.anulado_motivo) } : null };
      if (s(o.diferencia_original) !== '') c.diferenciaOriginal = n(o.diferencia_original);
      if (s(o.calculado_al_contar) !== '') c.calculadoAlContar = n(o.calculado_al_contar);
      return c;
    });
    const bool = (v) => v === true || v === 'true' || v === 1 || v === 'TRUE';
    const rodeos = objs('Rodeos').map((o) => ({ id: s(o.id), nombre: s(o.nombre), ubicacion: s(o.ubicacion), orden: Number(o.orden), activo: bool(o.activo) }));
    const categorias = objs('Categorias').map((o) => ({ id: s(o.id), nombre: s(o.nombre), orden: Number(o.orden), activa: bool(o.activa), cuentaComoVaca: bool(o.cuenta_como_vaca), senasa: s(o.senasa) }));
    const parametros = Object.fromEntries(objs('Parametros').map((o) => [s(o.clave), JSON.parse(s(o.valor_json))]));
    return { app: s(ctrl.app), formato: Number(ctrl.formato), exportado: s(ctrl.exportado),
      cuentas: { movimientos: Number(ctrl.movimientos), conteos: Number(ctrl.conteos), rodeos: Number(ctrl.rodeos), categorias: Number(ctrl.categorias) },
      rodeos, categorias, movimientos, conteos, parametros };
  }
  self.excelHojasABackup = excelHojasABackup;
})();
