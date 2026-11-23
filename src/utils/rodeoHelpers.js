/**
 * Utilidades Centralizadas de Conteo de Hacienda y Detección Reproductiva
 * Establecimiento San José · Agroganadera Rincón del Sur S.A.
 */

export function calcRodeoCabezas(r) {
  if (!r) return 0;
  // Suma de categorías oficiales de la planilla maestra de San José
  const sumCats =
    (parseInt(r.vacas, 10) || 0) +
    (parseInt(r.terneros, 10) || 0) +
    (parseInt(r.toros_padres, 10) || 0) +
    (parseInt(r.toritos, 10) || 0) +
    (parseInt(r.vacas_cut, 10) || 0) +
    (parseInt(r.vaquillonas_reposicion, 10) || 0);

  if (sumCats > 0) return sumCats;

  // Fallback si viene en campo pre-calculado
  return (
    Number(r.total_cabezas) ||
    Number(r.cantidad_cabezas) ||
    Number(r.total) ||
    Number(r.cabezas) ||
    Number(r.stock) ||
    0
  );
}

export function calcRodeoToros(r) {
  if (!r) return 0;
  return (
    (parseInt(r.toros_padres, 10) || 0) +
    (parseInt(r.toritos, 10) || 0) +
    (parseInt(r.toros, 10) || 0)
  );
}

export function isRodeoEnServicio(r) {
  if (!r) return false;
  const toros = calcRodeoToros(r);
  const nombre = (r.nombre || '').toLowerCase();
  const rol = (r.rol_protocolo || '').toLowerCase();
  const obs = (r.estado_observaciones || r.estado_reproductivo || '').toLowerCase();

  return Boolean(
    r.toros_en_servicio ||
    r.manejo_iatf ||
    r.repaso_toros ||
    r.es_iatf ||
    r.fecha_entore ||
    r.fecha_inseminacion ||
    r.fecha_repaso_toros ||
    r.toro_lote_asignado ||
    toros > 0 ||
    nombre.includes('servicio') ||
    nombre.includes('entore') ||
    nombre.includes('inseminaci') ||
    nombre.includes('iatf') ||
    rol.includes('cría') ||
    rol.includes('cria') ||
    obs.includes('entore') ||
    obs.includes('servicio') ||
    obs.includes('iatf')
  );
}

export function getRodeosInPotrero(potrero, rodeos = []) {
  if (!potrero || !Array.isArray(rodeos)) return [];
  const pNum = Number(potrero.numero != null ? potrero.numero : potrero);
  const pId = potrero.id != null ? Number(potrero.id) : null;
  const pNom = (potrero.nombre || '').toLowerCase();

  return rodeos.filter((r) => {
    const rPotNum = r.potrero_numero != null && r.potrero_numero !== '' ? Number(r.potrero_numero) : null;
    const rPotId = r.potrero_id != null ? Number(r.potrero_id) : null;

    if (rPotNum !== null && rPotNum === pNum) return true;
    if (rPotId !== null && pId !== null && rPotId === pId) return true;

    // Caso especial Potrero 2 / 3
    if ((pNum === 2 || pNum === 3) && (rPotNum === 2 || rPotNum === 3)) return true;

    // Coincidencia por nombre
    if (r.potrero_nombre && pNom && r.potrero_nombre.toLowerCase() === pNom) return true;
    if (r.potrero_nombre) {
      const match = r.potrero_nombre.match(/\d+/);
      if (match && parseInt(match[0], 10) === pNum) return true;
    }
    return false;
  });
}

export function calcPotreroHacienda(potrero, rodeos = []) {
  const rodeosEnP = getRodeosInPotrero(potrero, rodeos);
  const totalCabezas = rodeosEnP.reduce((sum, r) => sum + calcRodeoCabezas(r), 0);
  const totalToros = rodeosEnP.reduce((sum, r) => sum + calcRodeoToros(r), 0);
  const enServicio = rodeosEnP.some((r) => isRodeoEnServicio(r));

  return {
    rodeos: rodeosEnP,
    totalCabezas,
    totalToros,
    enServicio,
  };
}
