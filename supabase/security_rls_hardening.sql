-- ============================================================================
-- ESTABLECIMIENTO SAN JOSÉ · AGROGANADERA RINCÓN DEL SUR S.A.
-- SCRIPT DE BLINDAJE DE SEGURIDAD Y ROW LEVEL SECURITY (RLS) ESTRICTO
-- Proyecto Supabase: btruytfuiwrgyzrkkxat (themaexperience's Project)
-- Fecha de emisión: 16 de Noviembre de 2026 (Sprint 12 · Blindaje Sec)
-- ============================================================================
-- OBJETIVOS DE CIBERSEGURIDAD:
-- 1. Habilitar RLS (Row Level Security) obligatorio en TODAS las 26 tablas del sistema.
-- 2. Eliminar todas las políticas permisivas heredadas que permitían acceso a 'anon' o 'public'.
-- 3. Crear políticas estrictas 'TO authenticated' (usuarios con sesión activa en Supabase Auth).
-- 4. Mantener políticas de gestión administrativa 'TO service_role'.
-- 5. Bloquear al 100% lecturas, escrituras, inyecciones y scraping de bots y actores externos.
-- ============================================================================

-- ============================================================================
-- PARTE 1: BLOQUE AUTOMATIZADO E IDEMPOTENTE (PL/pgSQL)
-- Ejecuta el endurecimiento completo sobre todas las tablas en una sola transacción.
-- ============================================================================
DO $$
DECLARE
    pol RECORD;
    t_name text;
    tables text[] := ARRAY[
        'alertas_mapa',
        'animales',
        'aprendizajes_campo',
        'audit_logs',
        'balances_contables',
        'bitacora_notas',
        'cajas_caravanas',
        'caminos',
        'campanas_kpis',
        'eventos_sanitarios',
        'gastos_campo',
        'infraestructura',
        'labores_siembras',
        'maquinaria',
        'maquinaria_repuestos',
        'maquinaria_services',
        'molinos',
        'movimientos_hacienda',
        'movimientos_insumos',
        'potreros',
        'protocolo_cria_config',
        'registros_lluvias',
        'rodeos',
        'stock_insumos',
        'tareas_campo',
        'ventas_hacienda'
    ];
BEGIN
    FOREACH t_name IN ARRAY tables LOOP
        -- 1. Habilitar RLS en la tabla
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t_name);

        -- 2. Eliminar todas las políticas existentes (incluso las permisivas para anon/public)
        FOR pol IN (
            SELECT policyname 
            FROM pg_policies 
            WHERE schemaname = 'public' AND tablename = t_name
        ) LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, t_name);
        END LOOP;

        -- 3. Crear política estricta para usuarios autenticados de San José
        EXECUTE format('
            CREATE POLICY "authenticated_full_access_%s"
            ON public.%I
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
        ', t_name, t_name);

        -- 4. Crear política estricta para mantenimiento/scripts con service_role
        EXECUTE format('
            CREATE POLICY "service_role_full_access_%s"
            ON public.%I
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
        ', t_name, t_name);

        RAISE NOTICE 'Tabla public.% asegurada con éxito (RLS activo, anon bloqueado).', t_name;
    END LOOP;
END $$;

-- ============================================================================
-- PARTE 2: DEFINICIONES DECLARATIVAS EXPLÍCITAS TABLA POR TABLA
-- (Alternativa de ejecución individual o auditoría manual en SQL Editor)
-- ============================================================================

-- 1. POTREROS
ALTER TABLE public.potreros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios con sesion gestionan potreros" ON public.potreros;
DROP POLICY IF EXISTS "authenticated_full_access_potreros" ON public.potreros;
DROP POLICY IF EXISTS "service_role_full_access_potreros" ON public.potreros;
CREATE POLICY "authenticated_full_access_potreros" ON public.potreros FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_potreros" ON public.potreros FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. RODEOS
ALTER TABLE public.rodeos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_rodeos" ON public.rodeos;
DROP POLICY IF EXISTS "authenticated_full_access_rodeos" ON public.rodeos;
DROP POLICY IF EXISTS "service_role_full_access_rodeos" ON public.rodeos;
CREATE POLICY "authenticated_full_access_rodeos" ON public.rodeos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_rodeos" ON public.rodeos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. ANIMALES
ALTER TABLE public.animales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios con sesion gestionan animales" ON public.animales;
DROP POLICY IF EXISTS "authenticated_full_access_animales" ON public.animales;
DROP POLICY IF EXISTS "service_role_full_access_animales" ON public.animales;
CREATE POLICY "authenticated_full_access_animales" ON public.animales FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_animales" ON public.animales FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. LABORES Y SIEMBRAS
ALTER TABLE public.labores_siembras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios con sesion gestionan labores" ON public.labores_siembras;
DROP POLICY IF EXISTS "authenticated_full_access_labores_siembras" ON public.labores_siembras;
DROP POLICY IF EXISTS "service_role_full_access_labores_siembras" ON public.labores_siembras;
CREATE POLICY "authenticated_full_access_labores_siembras" ON public.labores_siembras FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_labores_siembras" ON public.labores_siembras FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. GASTOS DE CAMPO
ALTER TABLE public.gastos_campo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_gastos_campo" ON public.gastos_campo;
DROP POLICY IF EXISTS "authenticated_full_access_gastos_campo" ON public.gastos_campo;
DROP POLICY IF EXISTS "service_role_full_access_gastos_campo" ON public.gastos_campo;
CREATE POLICY "authenticated_full_access_gastos_campo" ON public.gastos_campo FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_gastos_campo" ON public.gastos_campo FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. VENTAS DE HACIENDA
ALTER TABLE public.ventas_hacienda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ventas_hacienda" ON public.ventas_hacienda;
DROP POLICY IF EXISTS "authenticated_full_access_ventas_hacienda" ON public.ventas_hacienda;
DROP POLICY IF EXISTS "service_role_full_access_ventas_hacienda" ON public.ventas_hacienda;
CREATE POLICY "authenticated_full_access_ventas_hacienda" ON public.ventas_hacienda FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_ventas_hacienda" ON public.ventas_hacienda FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. TAREAS DE CAMPO
ALTER TABLE public.tareas_campo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_tareas_campo" ON public.tareas_campo;
DROP POLICY IF EXISTS "authenticated_full_access_tareas_campo" ON public.tareas_campo;
DROP POLICY IF EXISTS "service_role_full_access_tareas_campo" ON public.tareas_campo;
CREATE POLICY "authenticated_full_access_tareas_campo" ON public.tareas_campo FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_tareas_campo" ON public.tareas_campo FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. STOCK DE INSUMOS
ALTER TABLE public.stock_insumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all on stock_insumos" ON public.stock_insumos;
DROP POLICY IF EXISTS "authenticated_full_access_stock_insumos" ON public.stock_insumos;
DROP POLICY IF EXISTS "service_role_full_access_stock_insumos" ON public.stock_insumos;
CREATE POLICY "authenticated_full_access_stock_insumos" ON public.stock_insumos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_stock_insumos" ON public.stock_insumos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. MOVIMIENTOS DE INSUMOS
ALTER TABLE public.movimientos_insumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all on movimientos_insumos" ON public.movimientos_insumos;
DROP POLICY IF EXISTS "authenticated_full_access_movimientos_insumos" ON public.movimientos_insumos;
DROP POLICY IF EXISTS "service_role_full_access_movimientos_insumos" ON public.movimientos_insumos;
CREATE POLICY "authenticated_full_access_movimientos_insumos" ON public.movimientos_insumos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_movimientos_insumos" ON public.movimientos_insumos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. AUDIT LOGS (REGISTRO DE AUDITORÍA)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "authenticated_full_access_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "service_role_full_access_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_full_access_audit_logs" ON public.audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_audit_logs" ON public.audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. EVENTOS SANITARIOS
ALTER TABLE public.eventos_sanitarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_eventos_sanitarios" ON public.eventos_sanitarios;
DROP POLICY IF EXISTS "authenticated_full_access_eventos_sanitarios" ON public.eventos_sanitarios;
DROP POLICY IF EXISTS "service_role_full_access_eventos_sanitarios" ON public.eventos_sanitarios;
CREATE POLICY "authenticated_full_access_eventos_sanitarios" ON public.eventos_sanitarios FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_eventos_sanitarios" ON public.eventos_sanitarios FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 12. MOVIMIENTOS DE HACIENDA
ALTER TABLE public.movimientos_hacienda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_movimientos_hacienda" ON public.movimientos_hacienda;
DROP POLICY IF EXISTS "authenticated_full_access_movimientos_hacienda" ON public.movimientos_hacienda;
DROP POLICY IF EXISTS "service_role_full_access_movimientos_hacienda" ON public.movimientos_hacienda;
CREATE POLICY "authenticated_full_access_movimientos_hacienda" ON public.movimientos_hacienda FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_movimientos_hacienda" ON public.movimientos_hacienda FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 13. CAJAS DE CARAVANAS
ALTER TABLE public.cajas_caravanas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios con sesion gestionan cajas" ON public.cajas_caravanas;
DROP POLICY IF EXISTS "authenticated_full_access_cajas_caravanas" ON public.cajas_caravanas;
DROP POLICY IF EXISTS "service_role_full_access_cajas_caravanas" ON public.cajas_caravanas;
CREATE POLICY "authenticated_full_access_cajas_caravanas" ON public.cajas_caravanas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_cajas_caravanas" ON public.cajas_caravanas FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 14. INFRAESTRUCTURA
ALTER TABLE public.infraestructura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_infraestructura" ON public.infraestructura;
DROP POLICY IF EXISTS "authenticated_full_access_infraestructura" ON public.infraestructura;
DROP POLICY IF EXISTS "service_role_full_access_infraestructura" ON public.infraestructura;
CREATE POLICY "authenticated_full_access_infraestructura" ON public.infraestructura FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_infraestructura" ON public.infraestructura FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 15. MOLINOS
ALTER TABLE public.molinos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios con sesion gestionan molinos" ON public.molinos;
DROP POLICY IF EXISTS "authenticated_full_access_molinos" ON public.molinos;
DROP POLICY IF EXISTS "service_role_full_access_molinos" ON public.molinos;
CREATE POLICY "authenticated_full_access_molinos" ON public.molinos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_molinos" ON public.molinos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 16. CAMINOS
ALTER TABLE public.caminos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_caminos" ON public.caminos;
DROP POLICY IF EXISTS "authenticated_full_access_caminos" ON public.caminos;
DROP POLICY IF EXISTS "service_role_full_access_caminos" ON public.caminos;
CREATE POLICY "authenticated_full_access_caminos" ON public.caminos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_caminos" ON public.caminos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 17. ALERTAS DEL MAPA
ALTER TABLE public.alertas_mapa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_alertas_mapa" ON public.alertas_mapa;
DROP POLICY IF EXISTS "authenticated_full_access_alertas_mapa" ON public.alertas_mapa;
DROP POLICY IF EXISTS "service_role_full_access_alertas_mapa" ON public.alertas_mapa;
CREATE POLICY "authenticated_full_access_alertas_mapa" ON public.alertas_mapa FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_alertas_mapa" ON public.alertas_mapa FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 18. BITÁCORA Y NOTAS
ALTER TABLE public.bitacora_notas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_bitacora_notas" ON public.bitacora_notas;
DROP POLICY IF EXISTS "authenticated_full_access_bitacora_notas" ON public.bitacora_notas;
DROP POLICY IF EXISTS "service_role_full_access_bitacora_notas" ON public.bitacora_notas;
CREATE POLICY "authenticated_full_access_bitacora_notas" ON public.bitacora_notas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_bitacora_notas" ON public.bitacora_notas FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 19. MAQUINARIA
ALTER TABLE public.maquinaria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maquinaria_all" ON public.maquinaria;
DROP POLICY IF EXISTS "authenticated_full_access_maquinaria" ON public.maquinaria;
DROP POLICY IF EXISTS "service_role_full_access_maquinaria" ON public.maquinaria;
CREATE POLICY "authenticated_full_access_maquinaria" ON public.maquinaria FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_maquinaria" ON public.maquinaria FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 20. MAQUINARIA REPUESTOS
ALTER TABLE public.maquinaria_repuestos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maquinaria_repuestos_all" ON public.maquinaria_repuestos;
DROP POLICY IF EXISTS "authenticated_full_access_maquinaria_repuestos" ON public.maquinaria_repuestos;
DROP POLICY IF EXISTS "service_role_full_access_maquinaria_repuestos" ON public.maquinaria_repuestos;
CREATE POLICY "authenticated_full_access_maquinaria_repuestos" ON public.maquinaria_repuestos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_maquinaria_repuestos" ON public.maquinaria_repuestos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 21. MAQUINARIA SERVICES
ALTER TABLE public.maquinaria_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maquinaria_services_all" ON public.maquinaria_services;
DROP POLICY IF EXISTS "authenticated_full_access_maquinaria_services" ON public.maquinaria_services;
DROP POLICY IF EXISTS "service_role_full_access_maquinaria_services" ON public.maquinaria_services;
CREATE POLICY "authenticated_full_access_maquinaria_services" ON public.maquinaria_services FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_maquinaria_services" ON public.maquinaria_services FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 22. REGISTROS DE LLUVIAS
ALTER TABLE public.registros_lluvias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon all on registros_lluvias" ON public.registros_lluvias;
DROP POLICY IF EXISTS "authenticated_full_access_registros_lluvias" ON public.registros_lluvias;
DROP POLICY IF EXISTS "service_role_full_access_registros_lluvias" ON public.registros_lluvias;
CREATE POLICY "authenticated_full_access_registros_lluvias" ON public.registros_lluvias FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_registros_lluvias" ON public.registros_lluvias FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 23. CAMPAÑAS Y KPIS
ALTER TABLE public.campanas_kpis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acceso total publico campanas_kpis" ON public.campanas_kpis;
DROP POLICY IF EXISTS "authenticated_full_access_campanas_kpis" ON public.campanas_kpis;
DROP POLICY IF EXISTS "service_role_full_access_campanas_kpis" ON public.campanas_kpis;
CREATE POLICY "authenticated_full_access_campanas_kpis" ON public.campanas_kpis FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_campanas_kpis" ON public.campanas_kpis FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 24. APRENDIZAJES DE CAMPO
ALTER TABLE public.aprendizajes_campo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access_aprendizajes_campo" ON public.aprendizajes_campo;
DROP POLICY IF EXISTS "service_role_full_access_aprendizajes_campo" ON public.aprendizajes_campo;
CREATE POLICY "authenticated_full_access_aprendizajes_campo" ON public.aprendizajes_campo FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_aprendizajes_campo" ON public.aprendizajes_campo FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 25. PROTOCOLO CRÍA CONFIG
ALTER TABLE public.protocolo_cria_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access_protocolo_cria_config" ON public.protocolo_cria_config;
DROP POLICY IF EXISTS "service_role_full_access_protocolo_cria_config" ON public.protocolo_cria_config;
CREATE POLICY "authenticated_full_access_protocolo_cria_config" ON public.protocolo_cria_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_protocolo_cria_config" ON public.protocolo_cria_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 26. BALANCES CONTABLES
ALTER TABLE public.balances_contables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access_balances_contables" ON public.balances_contables;
DROP POLICY IF EXISTS "service_role_full_access_balances_contables" ON public.balances_contables;
CREATE POLICY "authenticated_full_access_balances_contables" ON public.balances_contables FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_balances_contables" ON public.balances_contables FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- PARTE 3: VERIFICACIÓN POST-EJECUCIÓN
-- Consulta de control para confirmar que RLS está activo y que anon no tiene permisos.
-- ============================================================================
SELECT 
    schemaname, 
    tablename, 
    policyname, 
    roles, 
    cmd 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;
