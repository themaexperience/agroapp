-- ============================================================================
-- TABLAS Y POLÍTICAS RLS PARA SISTEMA INTEGRAL DE CARAVANAS SAN JOSÉ (SPRINT N)
-- Agroganadera Rincón del Sur S.A. · Establecimiento San José
-- ============================================================================

-- 1. Tabla de lotes y compras de caravanas (cajas / remitos SENASA)
CREATE TABLE IF NOT EXISTS public.caravanas_lotes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  caja_numero TEXT,
  marca TEXT DEFAULT 'Allflex SENASA',
  color_tipo TEXT DEFAULT 'Amarilla Botón / Tarjeta',
  cuig TEXT DEFAULT 'SJ001',
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  en_stock INTEGER NOT NULL DEFAULT 0,
  puestas INTEGER NOT NULL DEFAULT 0,
  bajas INTEGER NOT NULL DEFAULT 0,
  fecha_compra DATE,
  proveedor TEXT,
  remito_numero TEXT,
  observaciones TEXT
);

-- Habilitar RLS en caravanas_lotes
ALTER TABLE public.caravanas_lotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access_caravanas_lotes" ON public.caravanas_lotes;
DROP POLICY IF EXISTS "service_role_full_access_caravanas_lotes" ON public.caravanas_lotes;

CREATE POLICY "authenticated_full_access_caravanas_lotes" ON public.caravanas_lotes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_caravanas_lotes" ON public.caravanas_lotes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Asegurar columnas de ciclo de vida en la tabla animales (caravanas individuales)
-- Estado: 'EN_CAJA' | 'PUESTA_CAMPO' | 'BAJA_VENTA' | 'BAJA_MUERTE' | 'REEMPLAZADA'
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS estado_caravana TEXT DEFAULT 'PUESTA_CAMPO';
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS lote_id BIGINT;
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS fecha_colocacion DATE;
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS dte_numero TEXT;
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS motivo_baja TEXT;
ALTER TABLE public.animales ADD COLUMN IF NOT EXISTS cuig TEXT;

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_animales_caravana ON public.animales (caravana);
CREATE INDEX IF NOT EXISTS idx_animales_rodeo ON public.animales (rodeo);
CREATE INDEX IF NOT EXISTS idx_animales_estado_caravana ON public.animales (estado_caravana);
CREATE INDEX IF NOT EXISTS idx_caravanas_lotes_rango ON public.caravanas_lotes (desde, hasta);
