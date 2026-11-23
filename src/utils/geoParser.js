/**
 * Utilidades para importar archivos GeoJSON (.geojson, .json) y KML (.kml),
 * calcular hectáreas aproximadas de polígonos y generar polígonos de referencia
 * centrados en Las Flores, Buenos Aires (-36.01, -59.10).
 */

export const LAS_FLORES_CENTER = [-35.868, -58.945];

/**
 * Calcula el área aproximada en hectáreas de un anillo de coordenadas GeoJSON [[lng, lat], ...]
 */
export function calculatePolygonHectares(coordsRing) {
  if (!Array.isArray(coordsRing) || coordsRing.length < 3) return 0;
  const R = 6378137; // Radio terrestre en metros
  let area = 0;
  for (let i = 0; i < coordsRing.length; i++) {
    const [lng1, lat1] = coordsRing[i];
    const [lng2, lat2] = coordsRing[(i + 1) % coordsRing.length];
    const x1 = (lng1 * Math.PI) / 180;
    const x2 = (lng2 * Math.PI) / 180;
    const y1 = (lat1 * Math.PI) / 180;
    const y2 = (lat2 * Math.PI) / 180;
    area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
  }
  const areaSqMeters = Math.abs((area * R * R) / 2.0);
  return Math.round((areaSqMeters / 10000) * 10) / 10;
}

/**
 * Convierte un documento XML KML en una lista de Features GeoJSON
 */
export function parseKmlToFeatures(kmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(kmlText, 'text/xml');
  const placemarks = Array.from(xml.getElementsByTagName('Placemark'));
  const features = [];

  placemarks.forEach((pm, idx) => {
    const nameEl = pm.getElementsByTagName('name')[0];
    const descEl = pm.getElementsByTagName('description')[0];
    const rawName = nameEl ? nameEl.textContent.trim() : `Lote ${idx + 1}`;
    const description = descEl ? descEl.textContent.trim() : '';

    // Extraer datos extendidos si existen
    const extendedProps = {};
    const simpleDataEls = Array.from(pm.getElementsByTagName('SimpleData'));
    simpleDataEls.forEach((sd) => {
      const attrName = sd.getAttribute('name');
      if (attrName) extendedProps[attrName.toLowerCase()] = sd.textContent.trim();
    });

    const dataEls = Array.from(pm.getElementsByTagName('Data'));
    dataEls.forEach((d) => {
      const attrName = d.getAttribute('name');
      const valEl = d.getElementsByTagName('value')[0];
      if (attrName && valEl) {
        extendedProps[attrName.toLowerCase()] = valEl.textContent.trim();
      }
    });

    // Buscar Polígonos
    const polygons = Array.from(pm.getElementsByTagName('Polygon'));
    polygons.forEach((polyEl) => {
      const coordEl = polyEl.getElementsByTagName('coordinates')[0];
      if (!coordEl) return;
      const ring = coordEl.textContent
        .trim()
        .split(/\s+/)
        .map((tuple) => {
          const parts = tuple.split(',').map(Number);
          return [parts[0], parts[1]];
        })
        .filter((pair) => !Number.isNaN(pair[0]) && !Number.isNaN(pair[1]));

      if (ring.length >= 3) {
        const geometry = {
          type: 'Polygon',
          coordinates: [ring],
        };
        const calcHa = calculatePolygonHectares(ring);
        features.push({
          type: 'Feature',
          properties: {
            name: rawName,
            description,
            hectareas_calculadas: calcHa,
            ...extendedProps,
          },
          geometry,
        });
      }
    });
  });

  return features;
}

/**
 * Parsea un archivo (.geojson, .json o .kml) y devuelve una lista normalizada de potreros candidatos
 */
export function parseGeoFileContent(fileName, textContent) {
  const lower = fileName.toLowerCase();
  let rawFeatures = [];

  if (lower.endsWith('.kml')) {
    rawFeatures = parseKmlToFeatures(textContent);
  } else {
    const parsed = JSON.parse(textContent);
    if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
      rawFeatures = parsed.features;
    } else if (parsed.type === 'Feature') {
      rawFeatures = [parsed];
    } else if (parsed.type === 'Polygon' || parsed.type === 'MultiPolygon') {
      rawFeatures = [{ type: 'Feature', properties: { name: 'Potrero 1' }, geometry: parsed }];
    }
  }

  return rawFeatures
    .filter((f) => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f, index) => {
      const props = f.properties || {};
      const rawName =
        props.nombre ||
        props.name ||
        props.Name ||
        props.potrero ||
        props.lote ||
        `Potrero ${index + 1}`;

      // Intentar detectar el número de potrero del nombre o propiedad
      const numMatch = String(props.numero || props.number || props.id || rawName).match(/\d+/);
      const numero = numMatch ? parseInt(numMatch[0], 10) : index + 1;

      const ring =
        f.geometry.type === 'Polygon'
          ? f.geometry.coordinates?.[0]
          : f.geometry.coordinates?.[0]?.[0];

      const calcHa = calculatePolygonHectares(ring || []);
      const hectareas =
        parseFloat(props.hectareas || props.has || props.sup || props.area_ha) ||
        calcHa ||
        50;

      const ambiente =
        props.ambiente ||
        props.tipo ||
        (index % 4 === 0 ? 'Loma (25%)' : 'Bajo Dulce / Salino (75%)');

      return {
        numero,
        nombre: String(rawName),
        hectareas: Number(hectareas.toFixed(1)),
        ambiente,
        molino_id: props.molino_id ? parseInt(props.molino_id, 10) : ((index % 11) + 1),
        cultivo_actual: props.cultivo_actual || props.cultivo || 'Campo Natural / Pastizal',
        estado_semaforo: props.estado_semaforo || 'Disponible',
        geojson_polygon: f.geometry,
      };
    });
}

/**
 * Calcula la distancia ortodrómica en kilómetros entre dos coordenadas [lat, lng]
 */
export function calcularDistanciaKm(coordA, coordB) {
  if (!coordA || !coordB) return 0;
  const lat1 = Number(Array.isArray(coordA) ? coordA[0] : (coordA.lat ?? coordA.latitud));
  const lon1 = Number(Array.isArray(coordA) ? coordA[1] : (coordA.lng ?? coordA.longitud));
  const lat2 = Number(Array.isArray(coordB) ? coordB[0] : (coordB.lat ?? coordB.latitud));
  const lon2 = Number(Array.isArray(coordB) ? coordB[1] : (coordB.lng ?? coordB.longitud));

  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return 0;

  const R = 6371; // Radio de la Tierra en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Optimiza el orden geográfico de una recorrida (TSP solver: Vecino Más Cercano + 2-Opt)
 * para minimizar kilómetros de trayecto y eliminar cruces o vueltas atrás entre potreros.
 * 
 * @param {Array<number>} startCoords - [lat, lng] del punto de salida (Casco)
 * @param {Array<Object>} items - Lista de paradas a ordenar, cada una con propiedad `coordenadas: [lat, lng]`
 * @returns {{ rutaOrdenada: Array<Object>, distanciaTotalKm: number }}
 */
export function optimizarRutaGeografica(startCoords = LAS_FLORES_CENTER, items = []) {
  if (!items || items.length === 0) {
    return { rutaOrdenada: [], distanciaTotalKm: 0 };
  }
  if (items.length === 1) {
    const dIda = calcularDistanciaKm(startCoords, items[0].coordenadas);
    return {
      rutaOrdenada: items,
      distanciaTotalKm: Number((dIda * 2).toFixed(1)),
    };
  }

  // 1. Algoritmo del Vecino Más Cercano (Nearest Neighbor) desde el Casco
  const unvisited = [...items];
  const tour = [];
  let currentPos = startCoords;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = calcularDistanciaKm(currentPos, unvisited[i].coordenadas);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    }
    const nextStop = unvisited.splice(nearestIdx, 1)[0];
    tour.push(nextStop);
    currentPos = nextStop.coordenadas;
  }

  // 2. Optimización 2-Opt para desenredar cruces y evitar volver atrás
  let improved = true;
  let iterations = 0;
  const maxIterations = 50;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    for (let i = 0; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const prevCoord = i === 0 ? startCoords : tour[i - 1].coordenadas;
        const currentCoordI = tour[i].coordenadas;
        const currentCoordK = tour[k].coordenadas;
        const nextCoordK = k === tour.length - 1 ? startCoords : tour[k + 1].coordenadas;

        const currentDist =
          calcularDistanciaKm(prevCoord, currentCoordI) +
          calcularDistanciaKm(currentCoordK, nextCoordK);
        const newDist =
          calcularDistanciaKm(prevCoord, currentCoordK) +
          calcularDistanciaKm(currentCoordI, nextCoordK);

        // Si el cruce acorta el recorrido más de 10 metros
        if (newDist < currentDist - 0.01) {
          const slice = tour.slice(i, k + 1).reverse();
          tour.splice(i, k - i + 1, ...slice);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  // 3. Calcular distancia total acumulada (Casco -> Parada 1 -> ... -> Parada N -> Casco)
  let totalKm = 0;
  let prev = startCoords;
  for (let i = 0; i < tour.length; i++) {
    const rawDist = calcularDistanciaKm(prev, tour[i].coordenadas);
    const isEnCasco =
      Number(tour[i].numero || tour[i].potrero_numero) === 14 ||
      (tour[i].nombre && String(tour[i].nombre).toLowerCase().includes('casco')) ||
      rawDist <= 0.35;
    const d = isEnCasco ? 0.2 : rawDist;

    tour[i].distancia_desde_anterior_km = Number(d.toFixed(1));
    totalKm += d;
    prev = tour[i].coordenadas;
  }
  // Retorno al Casco
  const retDist = calcularDistanciaKm(prev, startCoords);
  totalKm += retDist <= 0.35 ? 0.2 : retDist;

  return {
    rutaOrdenada: tour,
    distanciaTotalKm: Number(totalKm.toFixed(1)),
  };
}

/**
 * Convierte coordenadas en grados decimales o formato sexagesimal (DMS) a número flotante decimal
 */
export function parseCoordinateToDecimal(val) {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const str = String(val).trim();
  const num = parseFloat(str);
  if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(str)) {
    return num;
  }
  // Formato DMS: 35°52'05"S 58°56'42"W
  const match = str.match(/(\d+)[°º\s]+(\d+)['′\s]+([\d.]+)?["″\s]*([NSEWO])/i);
  if (match) {
    const deg = parseFloat(match[1]) || 0;
    const min = parseFloat(match[2]) || 0;
    const sec = parseFloat(match[3]) || 0;
    const hemi = match[4].toUpperCase();
    let dec = deg + min / 60 + sec / 3600;
    if (hemi === 'S' || hemi === 'W' || hemi === 'O') {
      dec = -dec;
    }
    return dec;
  }
  return isNaN(num) ? null : num;
}

/**
 * Determina si un punto [lat, lng] está contenido dentro de un polígono GeoJSON (Ray-casting algorithm)
 */
export function isPointInPolygon(point, polygonCoords) {
  let ptLat, ptLng;
  if (Array.isArray(point)) {
    ptLat = Number(point[0]);
    ptLng = Number(point[1]);
  } else if (point && typeof point === 'object') {
    ptLat = Number(point.lat ?? point.latitud);
    ptLng = Number(point.lng ?? point.longitud);
  }
  if (isNaN(ptLat) || isNaN(ptLng)) return false;

  let ring = polygonCoords;
  if (ring && ring.type === 'Polygon' && Array.isArray(ring.coordinates)) {
    ring = ring.coordinates[0];
  } else if (ring && ring.type === 'MultiPolygon' && Array.isArray(ring.coordinates)) {
    ring = ring.coordinates[0]?.[0];
  } else if (Array.isArray(ring)) {
    while (Array.isArray(ring[0]) && Array.isArray(ring[0][0]) && Array.isArray(ring[0][0][0])) {
      ring = ring[0];
    }
    if (Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
      ring = ring[0];
    }
  }

  if (!Array.isArray(ring) || ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);

    const intersect =
      yi > ptLat !== yj > ptLat &&
      ptLng < ((xj - xi) * (ptLat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Cruce inteligente de coordenadas GPS y nombre/lote declarado en una Receta Agronómica (RAO)
 * contra los potreros de San José para preseleccionar automáticamente el potrero correspondiente.
 */
export function findPotreroByGpsOrName(latRaw, lngRaw, declaredName, potreros = []) {
  if (!potreros || potreros.length === 0) return null;

  const lat = parseCoordinateToDecimal(latRaw);
  const lng = parseCoordinateToDecimal(lngRaw);

  // 1. Point-in-polygon si hay coordenadas GPS válidas
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    const pt = [lat, lng];
    for (const p of potreros) {
      if (p.geojson_polygon) {
        if (isPointInPolygon(pt, p.geojson_polygon)) {
          return {
            potrero: p,
            metodo: 'gps_polygon',
            descripcion: `P#${p.numero} (${p.nombre}) localizado exactamente por coordenadas GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            lat,
            lng,
          };
        }
      }
    }

    // 2. Proximidad al centroide si el punto cayó justo en el camino perimetral o callejón (< 1.2 km)
    let closest = null;
    let minD = Infinity;
    for (const p of potreros) {
      let center = null;
      if (p.geojson_polygon?.coordinates?.[0]) {
        const ring = p.geojson_polygon.coordinates[0];
        const avgLng = ring.reduce((s, c) => s + Number(c[0] || 0), 0) / ring.length;
        const avgLat = ring.reduce((s, c) => s + Number(c[1] || 0), 0) / ring.length;
        center = [avgLat, avgLng];
      } else if (p.latitud && p.longitud) {
        center = [Number(p.latitud), Number(p.longitud)];
      }

      if (center) {
        const d = calcularDistanciaKm(pt, center);
        if (d < minD) {
          minD = d;
          closest = p;
        }
      }
    }

    if (closest && minD <= 1.5) {
      return {
        potrero: closest,
        metodo: 'gps_proximidad',
        distanciaKm: Number(minD.toFixed(2)),
        descripcion: `P#${closest.numero} (${closest.nombre}) asociado por cercanía GPS a ${(minD * 1000).toFixed(0)} m del centro`,
        lat,
        lng,
      };
    }
  }

  // 3. Coincidencia por Nombre de Lote declarado o Número de Potrero
  if (declaredName) {
    const clean = String(declaredName).toLowerCase().trim();

    // Extraer número explícito (ej: "Lote 10", "P17", "#7")
    const numMatch = clean.match(/(?:potrero|lote|p|#)?\s*(\d+)/i);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      const found = potreros.find((p) => Number(p.numero) === num);
      if (found) {
        return {
          potrero: found,
          metodo: 'nombre_numero',
          descripcion: `P#${found.numero} (${found.nombre}) detectado por número de lote declarado ("${declaredName}")`,
        };
      }
    }

    // Coincidencia por texto del nombre
    const textMatch = potreros.find((p) => {
      const pNom = (p.nombre || '').toLowerCase();
      return pNom && (clean.includes(pNom) || pNom.includes(clean));
    });
    if (textMatch) {
      return {
        potrero: textMatch,
        metodo: 'nombre_texto',
        descripcion: `P#${textMatch.numero} (${textMatch.nombre}) detectado por coincidencia de nombre ("${declaredName}")`,
      };
    }
  }

  return null;
}
