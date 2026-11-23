-- ====================================================================
-- ESTABLECIMIENTO SAN JOSÉ — SPRINT 4: MIGRACIÓN DE GESTIÓN GANADERA
-- Agroganadera Rincón del Sur S.A. · Las Flores, Buenos Aires
-- ====================================================================

-- 1. CONDICIÓN CORPORAL (1.0 a 5.0 ★) EN RODEOS Y ANIMALES
ALTER TABLE IF EXISTS rodeos 
  ADD COLUMN IF NOT EXISTS condicion_corporal NUMERIC(3,1) DEFAULT 3.0;

ALTER TABLE IF EXISTS animales 
  ADD COLUMN IF NOT EXISTS condicion_corporal NUMERIC(3,1) DEFAULT 3.0;

-- 2. RECEPTIVIDAD AGRONÓMICA (EV/ha) Y RECURSO FORRAJERO EN POTREROS
ALTER TABLE IF EXISTS potreros 
  ADD COLUMN IF NOT EXISTS recurso_forrajero TEXT DEFAULT 'Campo Natural',
  ADD COLUMN IF NOT EXISTS receptividad_ev_ha NUMERIC(4,2) DEFAULT 0.90,
  ADD COLUMN IF NOT EXISTS dias_descanso INTEGER DEFAULT 45,
  ADD COLUMN IF NOT EXISTS fecha_ultima_salida DATE;

-- 3. BITÁCORA DE APRENDIZAJES HISTÓRICOS Y SABIDURÍA TÉCNICA (IA)
CREATE TABLE IF NOT EXISTS aprendizajes_campo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL DEFAULT 'Manejo Forrajero', -- 'Manejo Forrajero', 'Sanidad', 'Carga Animal', 'Aguadas', 'Clima'
  entidad_tipo TEXT, -- 'potrero', 'rodeo', 'general'
  entidad_id TEXT, -- 'P12', 'Rodeo 3', etc.
  titulo TEXT NOT NULL,
  aprendizaje TEXT NOT NULL,
  fecha DATE DEFAULT CURRENT_DATE,
  autor TEXT DEFAULT 'Asesor Técnico',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar aprendizajes fundacionales de San José
INSERT INTO aprendizajes_campo (tipo, entidad_tipo, entidad_id, titulo, aprendizaje, autor)
VALUES
  ('Manejo Forrajero', 'potrero', 'P2/3', 'Respuesta a inundación temporal', 'En bajantes de laguna, esperar mínimo 40 días antes de ingresar vacas para no pisar el banco de raigrás.', 'Ing. Agrónoma'),
  ('Carga Animal', 'general', 'San José', 'Relación toros en entore', 'Mantener 4% de toros revisados clínica y andrológicamente antes del servicio de primavera.', 'Veterinario Sanitario'),
  ('Manejo Forrajero', 'potrero', 'P16', 'Promoción de Raigrás', 'Cerrar en febrero para permitir semillazón; pastorear recién tras la primera helada fuerte.', 'Encargado de Campo')
ON CONFLICT DO NOTHING;

-- 4. PROTOCOLO ORIENTATIVO DE CRÍA SAN JOSÉ (METAS FLEXIBLES)
CREATE TABLE IF NOT EXISTS protocolo_cria_config (
  id TEXT PRIMARY KEY DEFAULT 'san_jose_default',
  madres_objetivo INTEGER DEFAULT 1100,
  rodeos_vacas_cantidad INTEGER DEFAULT 7,
  vacas_por_rodeo INTEGER DEFAULT 160,
  rodeo_vaquillonas_cantidad INTEGER DEFAULT 1,
  porcentaje_toros NUMERIC(3,1) DEFAULT 4.0,
  reposicion_vaquillonas INTEGER DEFAULT 250,
  toritos_reposicion INTEGER DEFAULT 30,
  porcentaje_colorados NUMERIC(3,1) DEFAULT 50.0,
  porcentaje_negros NUMERIC(3,1) DEFAULT 50.0,
  entore_vaquillonas_periodo TEXT DEFAULT 'Septiembre a Diciembre',
  ubicacion_vacas_cut TEXT DEFAULT 'Potreros del frente (cercanos a manga y casco)',
  notas_flexibilidad TEXT DEFAULT 'Metas orientativas y flexibles adaptables al régimen de precipitaciones y oferta forrajera real.',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO protocolo_cria_config (id) VALUES ('san_jose_default')
ON CONFLICT (id) DO NOTHING;
