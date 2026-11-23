import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  LayoutDashboard,
  Map,
  Tags,
  Sprout,
  ClipboardList,
  RefreshCw,
  Droplets,
  CheckCircle2,
  AlertCircle,
  Database,
  Layers,
  Syringe,
  BookOpen,
  DollarSign,
  Calendar,
  CalendarDays,
  Wrench,
  Tractor,
  Lock,
  Unlock,
  Shield,
  X,
  Fuel,
  Wifi,
  WifiOff,
  Sparkles,
  LogOut,
  Download,
  BarChart3,
  Menu,
  Zap,
  Scale,
  FileText,
  FlaskConical,
  Edit2,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { APP_VERSION_LABEL } from './config/version.js';
import { obtenerDolarBlueEnVivo, formatDolarDateTime, formatDolarTime, deberiaAutoActualizarDolar } from './lib/dolarService.js';
import { getPreciosHaciendaRef, savePreciosHaciendaRef } from './utils/preciosRefHelper.js';
import { consultarPreciosHaciendaWebIA } from './lib/geminiService.js';
import LoginView from './components/LoginView';
import TableroInicioView from './components/TableroInicioView';
import MapaPotrerosView from './components/MapaPotrerosView';
import RodeosCaravanasView, { calcResumenRodeosOficial } from './components/RodeosCaravanasView';
import InformesEjecutivosView from './components/InformesEjecutivosView';
import CalendarioSanitarioView from './components/CalendarioSanitarioView';
import SiembrasView from './components/SiembrasView';
import CostosFinanzasView from './components/CostosFinanzasView';
import VentasView from './components/VentasView';
import MaquinariaTallerView from './components/MaquinariaTallerView';
import TareasCampoView from './components/TareasCampoView';
import BitacoraMovimientosView from './components/BitacoraMovimientosView';
import InsumosReservasView from './components/InsumosReservasView';
import CopilotoSanJoseDrawer from './components/CopilotoSanJoseDrawer';
import CuadrillaPlannerModal from './components/CuadrillaPlannerModal';
import SystemSnapshotsModal from './components/SystemSnapshotsModal';
import ConfirmDialog from './components/ConfirmDialog';
import NumericInput from './components/NumericInput';
import { getOfflineQueueCount, processOfflineQueue } from './utils/offlineQueue';
import { INFRAESTRUCTURA_OFICIAL } from './data/infraestructuraOficial';

function calcRodeoHeads(r) {
  if (!r) return 0;
  return (
    (Number(r.vacas) || 0) +
    (Number(r.terneros) || 0) +
    (Number(r.toros_padres) || 0) +
    (Number(r.toritos) || 0) +
    (Number(r.vacas_cut) || 0) +
    (Number(r.vaquillonas_reposicion) || 0)
  );
}

// Comparación estructural profunda y rápida para evitar re-renders destructivos al sincronizar
function isDataEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (a.length === 0 && b.length === 0) return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export default function App() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState('inicio'); // 'inicio' | 'mapa' | 'rodeos' | 'bitacora' | 'sanidad' | 'siembras' | 'costos' | 'tareas'
  const [fechaOperacion, setFechaOperacion] = useState(todayIso);
  const [dolarRef, setDolarRef] = useState(() => {
    try {
      return localStorage.getItem('sanjose_dolar_ref') || '1600';
    } catch {
      return '1600';
    }
  });
  const [blueInfo, setBlueInfo] = useState(() => {
    try {
      const raw = localStorage.getItem('san_jose_dolar_blue_live');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [actualizandoBlue, setActualizandoBlue] = useState(false);
  // Estado del candado del Dólar Blue: 'locked' (cerrado, auto diario) | 'unlocked' (abierto, manual)
  const [dolarModoManual, setDolarModoManual] = useState(() => {
    try {
      return localStorage.getItem('sanjose_dolar_manual_locked') === 'manual';
    } catch {
      return false;
    }
  });
  const [showFuenteTooltip, setShowFuenteTooltip] = useState(false);
  // Pizarra de Precios Ganaderos (MAG Cañuelas / Rosgan)
  const [preciosHacienda, setPreciosHacienda] = useState(() => getPreciosHaciendaRef());
  const [showPreciosHaciendaModal, setShowPreciosHaciendaModal] = useState(false);
  const [editandoPreciosHacienda, setEditandoPreciosHacienda] = useState(() => getPreciosHaciendaRef());
  const [consultandoPreciosIA, setConsultandoPreciosIA] = useState(false);
  const [showSnapshotsModal, setShowSnapshotsModal] = useState(false);
  const [isSandboxMode, setIsSandboxMode] = useState(() => {
    try {
      return localStorage.getItem('san_jose_sandbox_mode') === 'true';
    } catch {
      return false;
    }
  });

  const [initialSelectedPotreroNum, setInitialSelectedPotreroNum] = useState(null);
  const [initialTargetInfra, setInitialTargetInfra] = useState(null);
  const [draftTarea, setDraftTarea] = useState(null);
  const [navContext, setNavContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  // Estado de Autenticación Supabase
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Switch de Modo: 'admin' (acceso completo a costos y finanzas) | 'produccion' (modo campo sin números sensibles)
  const [appMode, setAppMode] = useState(() => {
    try {
      return localStorage.getItem('sanjose_app_mode') || 'admin';
    } catch {
      return 'admin';
    }
  });
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Estado de las tablas de Supabase
  const [potreros, setPotreros] = useState([]);
  const [molinos, setMolinos] = useState([]);
  const [infraestructura, setInfraestructura] = useState([]);
  const [alertasMapa, setAlertasMapa] = useState([]);
  const [caminos, setCaminos] = useState([]);
  const [tareas, setTareas] = useState([]);
  const [rodeos, setRodeos] = useState([]);
  const [movimientosHacienda, setMovimientosHacienda] = useState([]);
  const [eventosSanitarios, setEventosSanitarios] = useState([]);
  const [animales, setAnimales] = useState([]);
  const [cajasCaravanas, setCajasCaravanas] = useState([]);
  const [laboresSiembras, setLaboresSiembras] = useState([]);
  const [bitacoraNotas, setBitacoraNotas] = useState([]);
  const [gastosCampo, setGastosCampo] = useState([]);
  const [ventasHacienda, setVentasHacienda] = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [maquinariaRepuestos, setMaquinariaRepuestos] = useState([]);
  const [maquinariaServices, setMaquinariaServices] = useState([]);
  const [campanasKpis, setCampanasKpis] = useState([]);
  const [stockInsumos, setStockInsumos] = useState([]);
  const [movimientosInsumos, setMovimientosInsumos] = useState([]);
  const [proveedoresEsperados, setProveedoresEsperados] = useState([]);
  const [registrosLluvias, setRegistrosLluvias] = useState([]);
  const [balancesContables, setBalancesContables] = useState([]);
  const [caminosEstado, setCaminosEstado] = useState(() => {
    try {
      return localStorage.getItem('sanjose_caminos_estado') || 'Transitable';
    } catch {
      return 'Transitable';
    }
  });
  const [showCopilotoModal, setShowCopilotoModal] = useState(false);
  const [showCuadrillaModal, setShowCuadrillaModal] = useState(false);
  const [cuadrillaModalMode, setCuadrillaModalMode] = useState('GANADERA');
  const [cuadrillaInitialView, setCuadrillaInitialView] = useState('seleccion');
  const [activeCuadrillaRoute, setActiveCuadrillaRoute] = useState(() => {
    try {
      const saved = localStorage.getItem('sanjose_ruta_cuadrilla_activa');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const handleSaveCuadrillaRoute = useCallback((route) => {
    setActiveCuadrillaRoute(route);
    try {
      if (route) {
        localStorage.setItem('sanjose_ruta_cuadrilla_activa', JSON.stringify(route));
      } else {
        localStorage.removeItem('sanjose_ruta_cuadrilla_activa');
      }
    } catch (e) {
      console.error('Error guardando ruta activa de cuadrilla:', e);
    }
  }, []);

  const handleClearCuadrillaRoute = useCallback(() => {
    handleSaveCuadrillaRoute(null);
  }, [handleSaveCuadrillaRoute]);
  const [showCargaRapidaModal, setShowCargaRapidaModal] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);

  // Despachos y consumos de gasoil obtenidos desde movimientos_insumos
  const despachosGasoil = useMemo(() => {
    return movimientosInsumos.filter((m) => {
      const cat = (m.categoria || '').toLowerCase();
      const nom = (m.insumo_nombre || m.nombre || '').toLowerCase();
      const tipo = (m.tipo_movimiento || m.tipo || '').toLowerCase();
      return (
        cat.includes('combust') ||
        nom.includes('gasoil') ||
        tipo.includes('despacho') ||
        tipo.includes('consumo') ||
        tipo.includes('egreso')
      );
    });
  }, [movimientosInsumos]);

  function handleChangeCaminosEstado(nuevoEstado) {
    setCaminosEstado(nuevoEstado);
    try {
      localStorage.setItem('sanjose_caminos_estado', nuevoEstado);
    } catch {}
    notify(`Estado de caminos actualizado a: ${nuevoEstado}`, 'info');
  }

  function handleChangeDolarRef(val) {
    setDolarRef(val);
    try {
      localStorage.setItem('sanjose_dolar_ref', val);
    } catch {
      // ignore storage errors
    }
  }

  // Alternar candado del Dólar Blue (cerrado = automático, abierto = edición manual)
  const handleToggleDolarCandado = useCallback(async () => {
    if (!dolarModoManual) {
      // Pasa a MODO MANUAL (candado abierto)
      setDolarModoManual(true);
      try {
        localStorage.setItem('sanjose_dolar_manual_locked', 'manual');
      } catch {}
      notify('Modo manual activado: podés editar el valor del dólar libremente.', 'info');
    } else {
      // Vuelve a MODO AUTOMÁTICO (candado cerrado)
      setDolarModoManual(false);
      try {
        localStorage.removeItem('sanjose_dolar_manual_locked');
      } catch {}
      notify('Candado cerrado: retomando cotización automática del Dólar Blue.', 'info');
      // Re-consultar la cotización oficial en vivo del día
      setActualizandoBlue(true);
      try {
        const res = await obtenerDolarBlueEnVivo(true);
        if (res && res.rate) {
          setDolarRef(String(res.rate));
          try {
            localStorage.setItem('sanjose_dolar_ref', String(res.rate));
          } catch {}
          setBlueInfo(res);
        }
      } catch (e) {
        // ignore
      } finally {
        setActualizandoBlue(false);
      }
    }
  }, [dolarModoManual, notify]);

  async function handleConsultarHaciendaWebIA() {
    setConsultandoPreciosIA(true);
    try {
      const res = await consultarPreciosHaciendaWebIA();
      if (res && (res.ternero_kg_ars || res.novillito_kg_ars)) {
        setEditandoPreciosHacienda((prev) => ({
          ...prev,
          ternero_kg_ars: Number(res.ternero_kg_ars) || prev.ternero_kg_ars || 6300,
          novillito_kg_ars: Number(res.novillito_kg_ars) || prev.novillito_kg_ars || 4400,
          vaca_kg_ars: Number(res.vaca_kg_ars) || prev.vaca_kg_ars || 3100,
          toro_kg_ars: Number(res.toro_kg_ars) || prev.toro_kg_ars || 3300,
          fuente: res.fuente || 'MAG Cañuelas / Google Search',
          fechaActualizacion: new Date().toISOString(),
        }));
        notify('✓ Precios de hacienda obtenidos de la web. Revisá los valores y tocá Guardar.', 'success');
      } else {
        notify('No se obtuvieron valores en internet. Se mantienen los valores vigentes.', 'info');
      }
    } catch (err) {
      console.warn('Error consultando web hacienda:', err);
      notify('No se pudo conectar a la búsqueda web. Podés ingresar los valores manualmente.', 'warning');
    } finally {
      setConsultandoPreciosIA(false);
    }
  }

  function handleGuardarPreciosHacienda() {
    const saved = savePreciosHaciendaRef(editandoPreciosHacienda);
    setPreciosHacienda(saved);
    setShowPreciosHaciendaModal(false);
    notify('✓ Pizarra de Precios Ganaderos guardada y sincronizada con el Copilot IA', 'success');
  }

  const handleActualizarBlue = useCallback(async (force = true) => {
    setActualizandoBlue(true);
    try {
      const res = await obtenerDolarBlueEnVivo(force);
      if (res && res.rate) {
        setDolarRef(String(res.rate));
        try {
          localStorage.setItem('sanjose_dolar_ref', String(res.rate));
        } catch {}
        setBlueInfo(res);
        notify(
          `Dólar Blue actualizado: Compra $${res.compra.toLocaleString('es-AR')} / Venta $${res.venta.toLocaleString('es-AR')} (${formatDolarDateTime(res.fechaActualizacion)})`,
          'success'
        );
      }
    } catch (err) {
      notify(`Error al actualizar Dólar Blue: ${err?.message || err}`, 'error');
    } finally {
      setActualizandoBlue(false);
    }
  }, [notify]);

  // Auto-actualización diaria al iniciar: si es de un día anterior o >12hs y NO está en modo manual
  useEffect(() => {
    const necesitaRecarga = deberiaAutoActualizarDolar();
    obtenerDolarBlueEnVivo(necesitaRecarga)
      .then((res) => {
        if (res) {
          setBlueInfo(res);
          try {
            const esManual = localStorage.getItem('sanjose_dolar_manual_locked') === 'manual';
            if (!esManual && res.rate) {
              setDolarRef(String(res.rate));
              localStorage.setItem('sanjose_dolar_ref', String(res.rate));
            }
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const fetchAllData = useCallback(async (options = {}) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    setSyncError(null);
    const updateIfChanged = (setter, newVal) => {
      setter((prev) => (isDataEqual(prev, newVal) ? prev : newVal));
    };
    try {
      // Si está en Modo Sandbox, cargar el estado clonado localmente
      if (isSandboxMode) {
        try {
          const raw = localStorage.getItem('san_jose_sandbox_data');
          if (raw) {
            const d = JSON.parse(raw);
            if (d.potreros) updateIfChanged(setPotreros, d.potreros);
            if (d.molinos) updateIfChanged(setMolinos, d.molinos);
            if (d.infraestructura && Array.isArray(d.infraestructura)) {
              const cleaned = d.infraestructura.filter((item) => {
                if (item.origen === 'manual' || item.manual === true) return true;
                return !['Tranquera', 'Tranquerón', 'Bebida', 'Monte / Sombra', 'Monte'].includes(item.tipo);
              });
              updateIfChanged(setInfraestructura, cleaned.length > 0 ? cleaned : INFRAESTRUCTURA_OFICIAL);
            } else {
              updateIfChanged(setInfraestructura, INFRAESTRUCTURA_OFICIAL);
            }
            if (d.alertasMapa) updateIfChanged(setAlertasMapa, d.alertasMapa);
            if (d.caminos) updateIfChanged(setCaminos, d.caminos);
            if (d.tareas) updateIfChanged(setTareas, d.tareas);
            if (d.rodeos) updateIfChanged(setRodeos, d.rodeos);
            if (d.movimientosHacienda) updateIfChanged(setMovimientosHacienda, d.movimientosHacienda);
            if (d.eventosSanitarios) updateIfChanged(setEventosSanitarios, d.eventosSanitarios);
            if (d.animales) updateIfChanged(setAnimales, d.animales);
            if (d.cajasCaravanas) updateIfChanged(setCajasCaravanas, d.cajasCaravanas);
            if (d.laboresSiembras) updateIfChanged(setLaboresSiembras, d.laboresSiembras);
            if (d.bitacoraNotas) updateIfChanged(setBitacoraNotas, d.bitacoraNotas);
            if (d.gastosCampo) updateIfChanged(setGastosCampo, d.gastosCampo);
            if (d.ventasHacienda) updateIfChanged(setVentasHacienda, d.ventasHacienda);
            if (d.maquinaria) updateIfChanged(setMaquinaria, d.maquinaria);
            if (d.maquinariaRepuestos) updateIfChanged(setMaquinariaRepuestos, d.maquinariaRepuestos);
            if (d.maquinariaServices) updateIfChanged(setMaquinariaServices, d.maquinariaServices);
            if (d.campanasKpis) updateIfChanged(setCampanasKpis, d.campanasKpis);
            if (d.stockInsumos) updateIfChanged(setStockInsumos, d.stockInsumos);
            if (d.movimientosInsumos) updateIfChanged(setMovimientosInsumos, d.movimientosInsumos);
            if (d.proveedoresEsperados) updateIfChanged(setProveedoresEsperados, d.proveedoresEsperados);
            if (d.registrosLluvias) updateIfChanged(setRegistrosLluvias, d.registrosLluvias);
            if (d.balancesContables) updateIfChanged(setBalancesContables, d.balancesContables);
            if (!silent) setLoading(false);
            return;
          }
        } catch (e) {
          console.warn('Error leyendo sandbox en fetchAllData:', e);
        }
      }

      const [
        potRes,
        molRes,
        infRes,
        aleRes,
        camRes,
        tarRes,
        rodRes,
        movRes,
        sanRes,
        aniRes,
        cajRes,
        labRes,
        bitRes,
        gasRes,
        venRes,
        maqRes,
        repRes,
        srvRes,
        cmpRes,
        insRes,
        movInsRes,
        provEspRes,
        lluvRes,
      ] = await Promise.all([
        supabase.from('potreros').select('*').order('numero', { ascending: true }),
        supabase.from('molinos').select('*').order('numero', { ascending: true }),
        supabase.from('infraestructura').select('*').order('id', { ascending: true }),
        supabase.from('alertas_mapa').select('*').order('id', { ascending: false }),
        supabase.from('caminos').select('*').order('id', { ascending: false }),
        supabase.from('tareas_campo').select('*').order('id', { ascending: false }),
        supabase.from('rodeos').select('*').order('orden', { ascending: true }),
        supabase.from('movimientos_hacienda').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }),
        supabase.from('eventos_sanitarios').select('*').order('id', { ascending: true }),
        (async () => {
          const { data: p1, error: e1 } = await supabase.from('animales').select('*').range(0, 999).order('id', { ascending: true });
          if (e1) return { data: null, error: e1 };
          if (!p1 || p1.length < 1000) return { data: p1 || [], error: null };
          const { data: p2, error: e2 } = await supabase.from('animales').select('*').range(1000, 2499).order('id', { ascending: true });
          if (e2) return { data: p1, error: null };
          return { data: [...p1, ...(p2 || [])], error: null };
        })(),
        supabase
          .from('cajas_caravanas')
          .select('*')
          .order('caja_numero', { ascending: true }),
        supabase
          .from('labores_siembras')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('bitacora_notas')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('gastos_campo')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('ventas_hacienda')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('maquinaria')
          .select('*')
          .order('orden', { ascending: true }),
        supabase
          .from('maquinaria_repuestos')
          .select('*')
          .order('orden', { ascending: true }),
        supabase
          .from('maquinaria_services')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('campanas_kpis')
          .select('*')
          .order('id', { ascending: false }),
        supabase
          .from('stock_insumos')
          .select('*')
          .order('id', { ascending: true }),
        supabase
          .from('movimientos_insumos')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('proveedores_esperados')
          .select('*')
          .order('semana_estimada', { ascending: true }),
        supabase
          .from('registros_lluvias')
          .select('*')
          .order('fecha', { ascending: false }),
      ]);

      const firstError =
        potRes.error || molRes.error || aniRes.error || cajRes.error || labRes.error;
      if (firstError) throw firstError;

      updateIfChanged(setPotreros, potRes.data || []);
      updateIfChanged(setMolinos, molRes.data || []);
      const newInf = infRes.data && infRes.data.length > 0 ? infRes.data : INFRAESTRUCTURA_OFICIAL;
      updateIfChanged(setInfraestructura, newInf);
      updateIfChanged(setAlertasMapa, aleRes.data || []);
      updateIfChanged(setCaminos, camRes.data || []);
      updateIfChanged(setTareas, tarRes.data || []);
      updateIfChanged(setRodeos, rodRes.data || []);
      updateIfChanged(setMovimientosHacienda, movRes.data || []);
      updateIfChanged(setEventosSanitarios, sanRes.data || []);
      updateIfChanged(setAnimales, aniRes.data || []);
      updateIfChanged(setCajasCaravanas, cajRes.data || []);
      updateIfChanged(setLaboresSiembras, labRes.data || []);
      updateIfChanged(setBitacoraNotas, bitRes.data || []);
      updateIfChanged(setGastosCampo, gasRes.data || []);
      updateIfChanged(setVentasHacienda, venRes.data || []);
      updateIfChanged(setMaquinaria, maqRes.data || []);
      updateIfChanged(setMaquinariaRepuestos, repRes.data || []);
      updateIfChanged(setMaquinariaServices, srvRes.data || []);
      updateIfChanged(setCampanasKpis, cmpRes.data || []);
      updateIfChanged(setStockInsumos, insRes.data || []);
      updateIfChanged(setMovimientosInsumos, movInsRes.data || []);
      updateIfChanged(setProveedoresEsperados, provEspRes.data || []);
      updateIfChanged(setRegistrosLluvias, lluvRes.data || []);

      try {
        const { data: balData } = await supabase
          .from('balances_contables')
          .select('*')
          .order('fecha_cierre', { ascending: false });
        updateIfChanged(setBalancesContables, balData || []);
      } catch (balErr) {
        console.warn('balances_contables fetch:', balErr);
      }

      setOfflineQueueCount(getOfflineQueueCount());
    } catch (err) {
      console.error('Error sincronizando con Supabase:', err);
      setSyncError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isSandboxMode]);

  const handleToggleSandbox = useCallback(() => {
    if (isSandboxMode) {
      if (window.confirm('¿Deseas salir del Modo Sandbox y volver a los datos reales de Producción en Supabase?')) {
        try {
          localStorage.removeItem('san_jose_sandbox_mode');
        } catch {}
        setIsSandboxMode(false);
        notify('Saliste del Modo Sandbox. Estás viendo la base de datos real de Producción.', 'success');
        setTimeout(() => {
          fetchAllData();
        }, 50);
      }
    } else {
      if (
        window.confirm(
          '¿Activar Modo Sandbox?\n\nSe clonará el estado actual en memoria local. Todas las pruebas o cambios que hagas NO afectarán a la base de datos real de Supabase.'
        )
      ) {
        try {
          const snapshotData = {
            potreros,
            molinos,
            infraestructura,
            alertasMapa,
            caminos,
            tareas,
            rodeos,
            movimientosHacienda,
            eventosSanitarios,
            animales,
            cajasCaravanas,
            laboresSiembras,
            bitacoraNotas,
            gastosCampo,
            ventasHacienda,
            maquinaria,
            maquinariaRepuestos,
            maquinariaServices,
            campanasKpis,
            stockInsumos,
            movimientosInsumos,
            proveedoresEsperados,
            registrosLluvias,
            balancesContables,
          };
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(snapshotData));
          localStorage.setItem('san_jose_sandbox_mode', 'true');
        } catch (e) {
          console.warn('Error guardando sandbox en localStorage:', e);
        }
        setIsSandboxMode(true);
        notify('🧪 Modo Sandbox ACTIVO: Los cambios son locales y no impactan en Supabase.', 'info');
      }
    }
  }, [
    isSandboxMode,
    potreros,
    molinos,
    infraestructura,
    alertasMapa,
    caminos,
    tareas,
    rodeos,
    movimientosHacienda,
    eventosSanitarios,
    animales,
    cajasCaravanas,
    laboresSiembras,
    bitacoraNotas,
    gastosCampo,
    ventasHacienda,
    maquinaria,
    maquinariaRepuestos,
    maquinariaServices,
    campanasKpis,
    stockInsumos,
    movimientosInsumos,
    proveedoresEsperados,
    registrosLluvias,
    balancesContables,
    fetchAllData,
    notify,
  ]);

  const handleSyncOfflineQueue = useCallback(async () => {
    setIsSyncingQueue(true);
    try {
      const res = await processOfflineQueue(supabase);
      if (res.processed > 0) {
        notify(`¡${res.processed} acción(es) sincronizada(s) con éxito!`, 'success');
        await fetchAllData();
      } else if (res.errors.length > 0) {
        notify(`Error al sincronizar cola: ${res.errors[0]?.error}`, 'error');
      } else {
        notify('La cola offline ya está al día.', 'info');
      }
      setOfflineQueueCount(getOfflineQueueCount());
    } catch (err) {
      notify(`Error al sincronizar offline: ${err.message}`, 'error');
    } finally {
      setIsSyncingQueue(false);
    }
  }, [fetchAllData, notify]);

  useEffect(() => {
    setOfflineQueueCount(getOfflineQueueCount());
    const handleOnline = () => {
      setIsOnline(true);
      notify('Conexión reestablecida. Sincronizando datos con Supabase...', 'success');
      if (getOfflineQueueCount() > 0) {
        handleSyncOfflineQueue();
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      notify('Modo Offline: Las cargas de campo se guardarán localmente.', 'info');
    };
    const handleQueueChanged = (e) => {
      setOfflineQueueCount(e.detail !== undefined ? e.detail : getOfflineQueueCount());
    };
    const handleSandboxChanged = () => {
      if (isSandboxMode) {
        fetchAllData();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sanjose_offline_queue_changed', handleQueueChanged);
    window.addEventListener('san_jose_sandbox_changed', handleSandboxChanged);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sanjose_offline_queue_changed', handleQueueChanged);
      window.removeEventListener('san_jose_sandbox_changed', handleSandboxChanged);
    };
  }, [handleSyncOfflineQueue, notify]);

  // Soporte PWA - Prompt de Instalación Nativa
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true
      );
    }
    return false;
  });

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsStandalone(true);
      notify('✓ Aplicación San José instalada con éxito en tu dispositivo.', 'success');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [notify]);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredInstallPrompt(null);
    }
  };

  // Verificar y escuchar estado de sesión activa en Supabase Auth
  useEffect(() => {
    let isMounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        if (isMounted) {
          setSession(currentSession);
          setAuthLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Error verificando sesión de Supabase:', err);
        if (isMounted) setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (isMounted) {
        setSession((prev) => {
          if (prev?.user?.id === newSession?.user?.id && prev?.access_token === newSession?.access_token) {
            return prev;
          }
          return newSession;
        });
        setAuthLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
      setSession(null);
      notify('Sesión cerrada con éxito.', 'info');
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
      notify(`Error al cerrar sesión: ${err.message}`, 'error');
    }
  }

  // Carga inicial al autenticar o cambiar de usuario (sin recargas destructivas al volver de Alt+Tab)
  const initialFetchDoneRef = useRef(false);
  const prevUserIdRef = useRef(null);
  useEffect(() => {
    if (session?.user?.id) {
      if (!initialFetchDoneRef.current || prevUserIdRef.current !== session.user.id) {
        initialFetchDoneRef.current = true;
        prevUserIdRef.current = session.user.id;
        fetchAllData();
      }
    } else {
      prevUserIdRef.current = null;
      initialFetchDoneRef.current = false;
    }
  }, [fetchAllData, session?.user?.id]);

  // Sincronización silenciosa en segundo plano al volver a la ventana (Alt+Tab / focus) throttled a máx 1 cada 60s
  useEffect(() => {
    let lastSilentSync = Date.now();
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastSilentSync > 60000) {
          lastSilentSync = now;
          fetchAllData({ silent: true });
        }
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [fetchAllData]);

  // Indicadores rápidos para el menú lateral
  const kpis = useMemo(() => {
    const haCargadas = potreros.reduce((acc, p) => acc + (Number(p.hectareas) || 0), 0);
    const resumenOficial = calcResumenRodeosOficial(rodeos);
    const cabezasEnRodeos = resumenOficial.total;
    const caravanasEnCampo = animales.filter(
      (a) => (a.estado || 'En campo') === 'En campo'
    ).length;

    const haciendaActiva = cabezasEnRodeos > 0 ? cabezasEnRodeos : caravanasEnCampo;
    const baseHa = haCargadas > 0 ? haCargadas : 2068;
    const cargaGlobal = (haciendaActiva / baseHa).toFixed(2);
    const infraList = infraestructura.length > 0 ? infraestructura : molinos;
    const infraOperativa = infraList.filter(
      (m) => (m.estado || 'Operativo') === 'Operativo'
    ).length;
    const tareasPendientes = tareas.filter((t) => !t.completada).length;
    const sanidadPendiente = eventosSanitarios.filter(
      (e) => e.estado !== 'Realizado'
    ).length;
    const proveedoresPendientes = (proveedoresEsperados || []).filter(
      (p) => p.estado !== 'Recibido'
    ).length;

    return {
      haCargadas,
      haciendaActiva,
      caravanasEnCampo,
      cargaGlobal,
      infraOperativa,
      totalInfra: infraList.length || 11,
      tareasPendientes,
      sanidadPendiente,
      proveedoresPendientes,
    };
  }, [potreros, rodeos, animales, molinos, infraestructura, tareas, eventosSanitarios, proveedoresEsperados]);

  const handleClearNavContext = useCallback(() => {
    setNavContext(null);
  }, []);

  // Soporte de navegación móvil nativa con History API y Deep-Linking entre módulos
  const navigateTab = useCallback((tab, arg2 = false, arg3 = null) => {
    let replace = false;
    let ctx = null;

    if (typeof arg2 === 'boolean') {
      replace = arg2;
      ctx = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      ctx = arg2;
      replace = false;
    }

    if (ctx) {
      setNavContext(ctx);
    }

    setActiveTab((prev) => {
      if (prev !== tab && typeof window !== 'undefined') {
        if (replace) {
          window.history.replaceState({ tab, modal: null }, '');
        } else {
          window.history.pushState({ tab, modal: null }, '');
        }
      }
      return tab;
    });
    setMobileMenuOpen(false);
  }, []);

  const openModal = useCallback(
    (modalName, mode = null, view = 'seleccion') => {
      if (typeof window !== 'undefined') {
        window.history.pushState({ tab: activeTab, modal: modalName }, '');
      }
      if (modalName === 'copiloto') setShowCopilotoModal(true);
      else if (modalName === 'cuadrilla') {
        if (mode) setCuadrillaModalMode(mode);
        setCuadrillaInitialView(view || 'seleccion');
        setShowCuadrillaModal(true);
      }
      else if (modalName === 'pin') setShowPinModal(true);
      else if (modalName === 'carga_rapida') setShowCargaRapidaModal(true);
      else if (modalName === 'menu') setMobileMenuOpen(true);
    },
    [activeTab]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!window.history.state) {
      window.history.replaceState({ tab: activeTab, modal: null }, '');
    }

    const handlePopState = (e) => {
      // 1. Si hay modal o menú abierto, cerrarlo primero sin salir de la app
      if (mobileMenuOpen) {
        setMobileMenuOpen(false);
        return;
      }
      if (showCopilotoModal) {
        setShowCopilotoModal(false);
        return;
      }
      if (showCuadrillaModal) {
        setShowCuadrillaModal(false);
        return;
      }
      if (showCargaRapidaModal) {
        setShowCargaRapidaModal(false);
        return;
      }
      if (showPinModal) {
        setShowPinModal(false);
        return;
      }

      // 2. Si venimos de otra pestaña en el historial
      if (e.state?.tab && e.state.tab !== activeTab) {
        setActiveTab(e.state.tab);
      } else if (!e.state?.tab && activeTab !== 'inicio') {
        setActiveTab('inicio');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, mobileMenuOpen, showCopilotoModal, showCuadrillaModal, showPinModal]);

  // Atajo de teclado global: Ctrl + K / Cmd + K para abrir/cerrar Copiloto IA desde cualquier pantalla
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCopilotoModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSelectPotreroInMap(potreroNum) {
    setInitialSelectedPotreroNum(potreroNum);
    navigateTab('mapa');
  }

  function handleSelectInfraInMap(infraItem) {
    setInitialTargetInfra(infraItem);
    navigateTab('mapa');
  }

  function handleCreateTareaFromItem(draft) {
    setDraftTarea(draft);
    navigateTab('tareas');
  }

  function handleVerifyPin(e) {
    if (e) e.preventDefault();
    if (pinInput.trim() === '1234') {
      setAppMode('admin');
      try {
        localStorage.setItem('sanjose_app_mode', 'admin');
      } catch {}
      setShowPinModal(false);
      setPinInput('');
      setPinError(false);
      notify('Modo Administración desbloqueado correctamente.', 'success');
    } else {
      setPinError(true);
    }
  }

  useEffect(() => {
    if (appMode === 'produccion' && (activeTab === 'costos' || activeTab === 'ventas' || activeTab === 'informes')) {
      navigateTab('inicio', true);
    }
  }, [appMode, activeTab, navigateTab]);

  const navItems = [
    {
      id: 'inicio',
      label: 'Inicio',
      icon: LayoutDashboard,
    },
    {
      id: 'mapa',
      label: 'Mapa',
      icon: Map,
    },
    {
      id: 'rodeos',
      label: 'Rodeos',
      icon: Tags,
    },
    {
      id: 'calendario',
      label: 'Calendario',
      icon: CalendarDays,
    },
    {
      id: 'tareas',
      label: 'Cuaderno de Campo',
      icon: ClipboardList,
    },
    {
      id: 'siembras',
      label: 'Siembras',
      icon: Sprout,
    },
    {
      id: 'insumos',
      label: 'Insumos',
      icon: Fuel,
    },
    {
      id: 'maquinaria',
      label: 'Maquinaria',
      icon: Wrench,
    },
    {
      id: 'costos',
      label: 'Finanzas',
      icon: DollarSign,
    },
    {
      id: 'ventas',
      label: 'Ventas & Liq.',
      icon: Scale,
    },
    {
      id: 'informes',
      label: 'Informes',
      icon: BarChart3,
    },
  ];

  const visibleNavItems = useMemo(
    () =>
      navItems.filter(
        (item) => appMode !== 'produccion' || (item.id !== 'costos' && item.id !== 'ventas' && item.id !== 'informes')
      ),
    [navItems, appMode]
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-emerald-950 to-slate-900 text-white font-sans p-4">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-emerald-900/60 p-2 mx-auto shadow-xl border border-emerald-500/30 flex items-center justify-center backdrop-blur-xs">
            <img
              src="/logo-san-jose.png"
              alt="Establecimiento San José"
              className="w-full h-full object-contain filter brightness-0 invert"
            />
          </div>
          <div className="text-sm font-extrabold text-white flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
            <span>Iniciando Establecimiento San José...</span>
          </div>
          <div className="text-xs text-emerald-300/80 font-medium">Agroganadera Rincón del Sur S.A. · Las Flores, Bs. As.</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        {toast && (
          <div
            className={`fixed bottom-5 right-5 z-[1000] max-w-md px-4 py-3 rounded-xl shadow-xl border flex items-center gap-3 text-xs font-semibold transition-all ${
              toast.type === 'error'
                ? 'bg-red-950 text-red-100 border-red-700'
                : 'bg-emerald-950 text-emerald-100 border-emerald-700'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        )}
        <LoginView onLoginSuccess={(sess) => setSession(sess)} notify={notify} />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-900 max-w-full">
      {/* Notificación flotante */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[1000] max-w-md px-4 py-3 rounded-xl shadow-xl border flex items-center gap-3 text-xs font-semibold transition-all ${
            toast.type === 'error'
              ? 'bg-red-950 text-red-100 border-red-700'
              : 'bg-emerald-950 text-emerald-100 border-emerald-700'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MODAL DE SEGURIDAD PARA DESBLOQUEAR MODO ADMINISTRACIÓN */}
      {showPinModal && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-slate-900 text-emerald-400 shadow-sm">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Modo Administración
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Ingresá el PIN de seguridad para acceder
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPinModal(false);
                  setPinInput('');
                  setPinError(false);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleVerifyPin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  PIN de Acceso (4 dígitos)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value);
                    setPinError(false);
                  }}
                  className={`w-full text-center text-2xl tracking-[0.4em] font-mono font-extrabold px-3 py-2.5 rounded-xl border ${
                    pinError
                      ? 'border-red-500 bg-red-50 text-red-900 focus:ring-red-500'
                      : 'border-slate-300 bg-white text-slate-900 focus:ring-emerald-700'
                  } focus:outline-none focus:ring-2`}
                />
                {pinError && (
                  <p className="text-xs font-bold text-red-600 mt-1.5 text-center">
                    PIN incorrecto. Reintentá el acceso.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowPinModal(false);
                    setPinInput('');
                    setPinError(false);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 font-extrabold text-xs transition shadow-sm"
                >
                  Desbloquear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CABECERA MÓVIL STICKY REAL CON SOMBRA Y BACKDROP BLUR */}
      <header className="md:hidden sticky top-0 z-40 w-full h-12 bg-slate-950/95 backdrop-blur-md text-white flex items-center justify-between px-3 shadow-md border-b border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => openModal('menu')}
          aria-label="Abrir menú"
          className="p-1.5 -ml-1 rounded-xl text-slate-200 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1.5">
          <img
            src="/logo-san-jose.png"
            alt="San José"
            className="w-6 h-6 rounded-lg bg-white p-0.5 object-contain"
          />
          <div className="flex flex-col items-center">
            <span className="font-extrabold text-xs tracking-tight text-white leading-none">
              San José
            </span>
            <span className="text-[8px] font-semibold text-emerald-400 leading-none mt-0.5">
              Las Flores
            </span>
          </div>
        </div>

        {/* BOTONES DERECHA: ALERTAS ACTIVAS + COPILOTO IA */}
        <div className="flex items-center gap-1.5">
          {kpis.sanidadPendiente + kpis.tareasPendientes > 0 && (
            <button
              type="button"
              onClick={() => navigateTab('inicio')}
              className="px-2 py-0.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-700/80 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
              title="Ver panel de Próximos Hitos y Alertas"
            >
              <AlertCircle className="w-3 h-3 text-amber-400" />
              <span>{kpis.sanidadPendiente + kpis.tareasPendientes}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openModal('copiloto')}
            aria-label="Copiloto IA"
            className="p-1.5 -mr-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xs transition cursor-pointer flex items-center justify-center active:scale-95"
            title="Abrir Copiloto IA San José"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
          </button>
        </div>
      </header>

      {/* DRAWER DESLIZANTE MÓVIL (z-[60] con backdrop semitransparente oscuro) */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-xs flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] h-full bg-white shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              {/* Encabezado del Drawer */}
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src="/logo-san-jose.png"
                    alt="San José"
                    className="w-9 h-9 rounded-xl bg-white p-0.5 object-contain shrink-0"
                  />
                  <div className="min-w-0">
                    <h2 className="text-xs font-bold leading-tight truncate">
                      Establecimiento San José
                    </h2>
                    <p className="text-[10px] text-emerald-400 font-semibold truncate">
                      Las Flores · 2.068 ha
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                  aria-label="Cerrar menú"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Botón Destacado: Carga Rápida (Sprint L) */}
              <div className="px-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openModal('carga_rapida');
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-98 cursor-pointer border border-amber-300/60"
                  title="Abrir atajos de carga rápida: Facturas, Movimiento de Hacienda o Tarea"
                >
                  <Zap className="w-4 h-4 fill-slate-950 text-slate-950 animate-pulse" />
                  <span>Carga Rápida</span>
                </button>
              </div>

              {/* Lista de Secciones (1 palabra con icono y badge) */}
              <div className="p-3 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Secciones del Campo
                </div>
                <nav className="space-y-1">
                  {visibleNavItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigateTab(item.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition flex items-center gap-2.5 border whitespace-nowrap shrink-0 cursor-pointer ${
                          isActive
                            ? 'bg-emerald-900 text-white border-emerald-950 shadow-xs'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-transparent hover:border-slate-200'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-emerald-300' : 'text-emerald-800'
                          }`}
                        />
                        <span className="text-xs font-bold truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Controles de Operación en Menú Móvil */}
              <div className="p-3 border-t border-slate-100 bg-slate-50/70 space-y-2.5">
                <div className="px-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Operación & Configuración
                </div>

                {/* 1. Fecha de Operación */}
                <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                  <label htmlFor="mobile-fecha-operacion" className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-emerald-700" />
                    Fecha de Operación:
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="mobile-fecha-operacion"
                      type="date"
                      value={fechaOperacion}
                      onChange={(e) => setFechaOperacion(e.target.value)}
                      className="w-full bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 font-bold text-xs text-slate-800"
                    />
                    {fechaOperacion !== todayIso && (
                      <button
                        type="button"
                        onClick={() => setFechaOperacion(todayIso)}
                        className="px-2 py-1 rounded-lg bg-emerald-800 text-white text-[10px] font-bold shrink-0"
                      >
                        Hoy
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. Dólar de Referencia & Candado en Sidebar (Solo Modo Admin) */}
                {appMode === 'admin' && (
                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5 text-amber-600" />
                        Tipo de Cambio ($/USD):
                      </span>
                      <div className="flex items-center gap-1">
                        {!dolarModoManual ? (
                          <span
                            onClick={() => {
                              setDolarModoManual(true);
                              try { localStorage.setItem('sanjose_dolar_manual_locked', 'manual'); } catch {}
                            }}
                            className="font-black text-xs text-slate-900 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 tabular-nums cursor-pointer hover:bg-amber-100 hover:border-amber-400"
                            title="Tocar para editar cotización manualmente"
                          >
                            ${Number(dolarRef || 1600).toLocaleString('es-AR')}
                          </span>
                        ) : (
                          <input
                            type="number"
                            step="1"
                            value={dolarRef}
                            onChange={(e) => handleChangeDolarRef(e.target.value)}
                            className="w-20 bg-white px-2 py-1 rounded-lg border border-amber-400 font-bold text-xs text-slate-900 text-right tabular-nums focus:ring-1 focus:ring-amber-500"
                          />
                        )}
                        <button
                          type="button"
                          onClick={handleToggleDolarCandado}
                          className={`p-1 rounded-lg transition active:scale-95 cursor-pointer ${
                            dolarModoManual
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'text-slate-400 hover:text-slate-700 bg-slate-100'
                          }`}
                          title={dolarModoManual ? 'Candado abierto: Modo manual. Clic para bloquear.' : 'Candado cerrado: Clic para desbloquear.'}
                        >
                          {dolarModoManual ? (
                            <Unlock className="w-3.5 h-3.5 text-amber-900" />
                          ) : (
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="pt-1.5 border-t border-slate-100 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => handleActualizarBlue(true)}
                        disabled={actualizandoBlue}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-extrabold text-[11px] border border-amber-300 transition active:scale-98 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-amber-800 ${actualizandoBlue ? 'animate-spin' : ''}`} />
                        <span>↻ Refrescar Blue</span>
                      </button>
                      {blueInfo && (
                        <div className="text-[10px] text-slate-500 font-medium text-center leading-tight">
                          Compra <strong>${Number(blueInfo.compra || 0).toLocaleString('es-AR')}</strong> / Venta <strong>${Number(blueInfo.venta || 0).toLocaleString('es-AR')}</strong>
                          <span className="block text-[9px] text-slate-400 mt-0.5">
                            {dolarModoManual ? 'Manual' : 'Auto'} · Act: {formatDolarTime(blueInfo.fechaActualizacion || blueInfo.timestamp) || '12:00'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 2.b Pizarra de Hacienda (MAG / Rosgan) en Sidebar Móvil (Solo Modo Admin) */}
                {appMode === 'admin' && (
                  <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/90 shadow-2xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-emerald-950 flex items-center gap-1">
                        <span>🐄</span>
                        <span>Pizarra Hacienda (MAG):</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditandoPreciosHacienda({ ...preciosHacienda });
                          setShowPreciosHaciendaModal(true);
                          setMobileMenuOpen(false);
                        }}
                        className="px-2 py-0.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-[10px] cursor-pointer transition active:scale-95"
                      >
                        Editar
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-800">
                      <div className="bg-white px-2 py-1 rounded border border-emerald-200 flex items-center justify-between">
                        <span className="font-sans text-[10px] text-slate-500 font-bold">Ternero:</span>
                        <span className="font-black text-emerald-900">${Number(preciosHacienda.ternero_kg_ars || 6300).toLocaleString('es-AR')}</span>
                      </div>
                      <div className="bg-white px-2 py-1 rounded border border-emerald-200 flex items-center justify-between">
                        <span className="font-sans text-[10px] text-slate-500 font-bold">Novillo:</span>
                        <span className="font-black text-emerald-900">${Number(preciosHacienda.novillito_kg_ars || 4400).toLocaleString('es-AR')}</span>
                      </div>
                      <div className="bg-white px-2 py-1 rounded border border-emerald-200 flex items-center justify-between">
                        <span className="font-sans text-[10px] text-slate-500 font-bold">Vaca:</span>
                        <span className="font-black text-slate-900">${Number(preciosHacienda.vaca_kg_ars || 3100).toLocaleString('es-AR')}</span>
                      </div>
                      <div className="bg-white px-2 py-1 rounded border border-emerald-200 flex items-center justify-between">
                        <span className="font-sans text-[10px] text-slate-500 font-bold">Toro:</span>
                        <span className="font-black text-slate-900">${Number(preciosHacienda.toro_kg_ars || 3300).toLocaleString('es-AR')}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Switch Modo Campo (Producción vs Admin) */}
                <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Modo de Operación:</div>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        setAppMode('produccion');
                        try { localStorage.setItem('sanjose_app_mode', 'produccion'); } catch {}
                        if (activeTab === 'costos') setActiveTab('inicio');
                        notify('Modo Producción activado.', 'info');
                      }}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold flex items-center justify-center gap-1 transition ${
                        appMode === 'produccion'
                          ? 'bg-emerald-800 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Tractor className="w-3.5 h-3.5" />
                      <span>Producción</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (appMode === 'admin') return;
                        setPinInput('');
                        setPinError(false);
                        setShowPinModal(true);
                      }}
                      className={`py-1.5 px-2 rounded-md text-xs font-bold flex items-center justify-center gap-1 transition ${
                        appMode === 'admin'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {appMode === 'admin' ? (
                        <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span>Admin</span>
                    </button>
                  </div>
                </div>

                {/* 4. Estado de Conexión / Sincronización */}
                <div className="p-2 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">Conexión:</span>
                  {offlineQueueCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        handleSyncOfflineQueue();
                      }}
                      disabled={isSyncingQueue}
                      className="px-2 py-0.5 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-black animate-pulse"
                    >
                      {offlineQueueCount} pendientes · Sincronizar
                    </button>
                  ) : isOnline ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                      <Wifi className="w-3 h-3 text-emerald-600" />
                      Online
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-lg border border-amber-300">
                      <WifiOff className="w-3 h-3 text-amber-700" />
                      Modo Offline
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer del Drawer */}
            <div className="p-3 border-t border-slate-100 bg-slate-50 space-y-2">
              <div className="flex items-center justify-between px-1 text-[11px] text-slate-400 mb-1">
                <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold">
                  <Database className="w-3.5 h-3.5" />
                  Supabase Conectado
                </span>
                <span className="font-semibold text-slate-500">{APP_VERSION_LABEL}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowSnapshotsModal(true);
                  }}
                  className="py-2 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Shield className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Respaldos</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleToggleSandbox();
                  }}
                  className={`py-2 px-2.5 rounded-xl border text-[11px] font-black flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    isSandboxMode
                      ? 'bg-amber-500 text-amber-950 border-amber-600'
                      : 'bg-white hover:bg-amber-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <FlaskConical className="w-3.5 h-3.5 text-amber-700" />
                  <span>{isSandboxMode ? 'Salir Sandbox' : 'Sandbox'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  fetchAllData();
                }}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-800' : ''}`} />
                <span>Actualizar Datos</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="w-full py-2 px-3 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-600 text-xs font-bold flex items-center justify-center gap-2 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar Sesión</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MENÚ LATERAL ESCRITORIO / TABLET (Compacto y escaneable) */}
      <aside className="hidden md:flex md:w-56 xl:w-64 bg-white border-r border-slate-200/90 shrink-0 flex-col justify-between md:sticky md:top-0 md:h-screen z-40">
        <div className="overflow-y-auto flex-1">
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/logo-san-jose.png"
                alt="Establecimiento San José"
                className="w-10 h-10 rounded-xl bg-white p-0.5 border border-slate-200 object-contain shadow-xs shrink-0"
              />
              <div className="min-w-0">
                <h1 className="text-xs font-bold text-slate-900 leading-tight truncate">
                  Establecimiento San José
                </h1>
                <p className="text-[10px] font-semibold text-emerald-800 truncate">
                  Agroganadera Rincón del Sur
                </p>
                <p className="text-[10px] text-slate-500 truncate">
                  Las Flores · 2.068 ha
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={fetchAllData}
              disabled={loading}
              title="Sincronizar datos con Supabase"
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-800' : ''}`}
              />
            </button>
          </div>

          {/* Botón Destacado: Carga Rápida (Sprint L) */}
          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={() => openModal('carga_rapida')}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-800 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-sm transition active:scale-98 cursor-pointer border border-amber-300/60"
              title="Abrir atajos de carga rápida: Facturas, Movimiento de Hacienda o Tarea"
            >
              <Zap className="w-4 h-4 fill-slate-950 text-slate-950 animate-pulse" />
              <span>Carga Rápida</span>
            </button>
          </div>

          <div className="p-3 space-y-1.5">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Menú de Gestión
            </div>
            <nav className="space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTab(item.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl transition-colors duration-150 flex items-center gap-2.5 border whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-emerald-900 text-white border-emerald-950 shadow-xs'
                        : 'bg-transparent hover:bg-slate-100/90 text-slate-700 hover:text-slate-950 border-transparent'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-emerald-300' : 'text-emerald-800'
                      }`}
                    />
                    <span className={`text-xs truncate whitespace-nowrap ${isActive ? 'font-black tracking-tight' : 'font-semibold'}`}>
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* BLOQUE INFERIOR: OPERACIÓN & CONFIGURACIÓN */}
        <div className="p-3 border-t border-slate-200/80 space-y-2.5 bg-slate-50/70 shrink-0">
          {/* Tarjeta de Métricas GIS (visible en pantallas con espacio) */}
          <div className="hidden xl:block p-2.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Superficie GIS</span>
              <span className="font-extrabold text-slate-900">
                {kpis.haCargadas.toLocaleString('es-AR', { maximumFractionDigits: 1 })} ha
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Rodeos Activos</span>
              <span className="font-extrabold text-slate-900">
                {kpis.haciendaActiva} cab. ({kpis.cargaGlobal} cab/ha)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Infraestructura</span>
              <span className="font-extrabold text-emerald-800">
                {kpis.infraOperativa}/{kpis.totalInfra} Operativos
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-0.5">
            <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Operación & Configuración
            </div>

            {/* Switch Modo Campo (Producción vs Admin) en Sidebar */}
            <div className="p-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
              <div className="flex items-center justify-between px-1 text-[10px] font-bold text-slate-500 uppercase">
                <span>Modo Activo:</span>
                <span className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold ${appMode === 'admin' ? 'bg-slate-900 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                  {appMode === 'admin' ? 'Gestión' : 'Campo'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setAppMode('produccion');
                    try { localStorage.setItem('sanjose_app_mode', 'produccion'); } catch {}
                    if (activeTab === 'costos' || activeTab === 'ventas' || activeTab === 'informes') navigateTab('inicio');
                    notify('Modo Producción activado.', 'info');
                  }}
                  className={`py-1 px-2 rounded-md text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                    appMode === 'produccion'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Modo Producción (Operativo de campo sin datos económicos)"
                >
                  <Tractor className="w-3.5 h-3.5" />
                  <span>Producción</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (appMode === 'admin') return;
                    setPinInput('');
                    setPinError(false);
                    openModal('pin');
                  }}
                  className={`py-1 px-2 rounded-md text-[11px] font-bold flex items-center justify-center gap-1 transition cursor-pointer ${
                    appMode === 'admin'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Modo Administración (requiere PIN)"
                >
                  {appMode === 'admin' ? (
                    <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Admin</span>
                </button>
              </div>
            </div>

            {/* Estado de Conexión / Sincronización */}
            <div className="w-full">
              {offlineQueueCount > 0 ? (
                <button
                  type="button"
                  onClick={handleSyncOfflineQueue}
                  disabled={isSyncingQueue}
                  className="w-full py-1.5 px-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold shadow-2xs transition animate-pulse flex items-center justify-between cursor-pointer"
                  title="Hay registros pendientes de sincronizar con Supabase. Clic para sincronizar ahora."
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-900 animate-ping" />
                    <span>{offlineQueueCount} pendientes</span>
                  </span>
                  <span className="bg-amber-950/15 text-[10px] px-1.5 py-0.5 rounded font-black">Sincronizar</span>
                </button>
              ) : isOnline ? (
                <div className="py-1 px-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium flex items-center justify-between shadow-2xs">
                  <span className="flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="font-bold">Online</span>
                  </span>
                  <span className="text-[10px] text-emerald-700/80 font-semibold">Sincronizado</span>
                </div>
              ) : (
                <div className="py-1 px-2.5 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center justify-between shadow-2xs animate-pulse">
                  <span className="flex items-center gap-1.5">
                    <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>Modo Offline</span>
                  </span>
                  <span className="text-[10px] text-amber-800 font-semibold">Local</span>
                </div>
              )}
            </div>

            {/* Botón Respaldos & Auditoría */}
            <button
              type="button"
              onClick={() => setShowSnapshotsModal(true)}
              className="w-full py-1.5 px-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-950 border border-slate-200 text-xs font-bold flex items-center justify-start gap-2 transition-colors shadow-2xs cursor-pointer"
              title="Puntos de Restauración y Respaldos en Supabase"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Respaldos</span>
            </button>

            {/* PWA Instalación nativa si está disponible */}
            {deferredInstallPrompt && !isStandalone && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="w-full py-1.5 px-2.5 rounded-xl bg-gradient-to-r from-emerald-800 to-emerald-700 hover:from-emerald-700 text-white text-xs font-bold shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                title="Instalar Establecimiento San José en tu pantalla de inicio"
              >
                <Download className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>Instalar Aplicación</span>
              </button>
            )}

            {/* Info Base de Datos y Versión */}
            <div className="flex items-center justify-between px-1 text-[10px] text-slate-600 font-medium">
              <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                <Database className="w-3 h-3" />
                Supabase
              </span>
              <span className="font-semibold text-slate-500" title="Versión y Sprint de la aplicación">
                {APP_VERSION_LABEL.split('—')[0].trim()}
              </span>
            </div>

            {/* Botón Salir / Cerrar Sesión */}
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full py-1.5 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-slate-600 hover:text-red-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors duration-150 shadow-2xs cursor-pointer"
              title={`Cerrar sesión (${session?.user?.email || 'usuario'})`}
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400 group-hover:text-red-600" />
              <span>Salir</span>
            </button>
          </div>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 min-w-0 flex flex-col max-w-full pt-0">
        <header className="hidden md:flex bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-3.5 h-12 items-center justify-between gap-2 sticky top-0 z-30 shadow-xs max-w-full overflow-visible transition-all">
          {/* GRUPO IZQUIERDA (CONTEXTO OPERATIVO): HITOS, FECHA DE OPERACIÓN, COTIZACIÓN DÓLAR */}
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            {/* 1. PÍLDORA DE HITOS (Navega a Calendario) */}
            {kpis.sanidadPendiente + kpis.tareasPendientes + (kpis.proveedoresPendientes || 0) > 0 && (
              <button
                type="button"
                onClick={() => navigateTab('calendario')}
                className="h-8 px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                title="Ver Calendario de Hitos, Sanidad y Logística"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>{kpis.sanidadPendiente + kpis.tareasPendientes + (kpis.proveedoresPendientes || 0)} hitos</span>
              </button>
            )}

            {/* 2. SELECTOR DE FECHA DE OPERACIÓN */}
            <div className="h-8 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 shrink-0 inline-flex items-center gap-1.5 text-xs font-medium shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
              <input
                id="global-fecha-operacion"
                type="date"
                value={fechaOperacion}
                onChange={(e) => setFechaOperacion(e.target.value)}
                className="bg-white h-6 px-1.5 rounded-lg border border-emerald-300 font-bold text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                title="Fecha de Operación de Campo"
              />
              {fechaOperacion !== todayIso && (
                <button
                  type="button"
                  onClick={() => setFechaOperacion(todayIso)}
                  className="h-5 px-1.5 rounded bg-emerald-800 text-white text-[10px] font-bold hover:bg-emerald-900 transition cursor-pointer"
                  title="Volver a la fecha de hoy"
                >
                  Hoy
                </button>
              )}
            </div>

            {/* 3. COTIZACIÓN DÓLAR COMPACTA (Solo Modo Admin / Gestión) */}
            {appMode === 'admin' && (
              <div className="relative shrink-0">
                <div
                  className="h-8 px-2.5 py-1 rounded-xl bg-amber-50/90 hover:bg-amber-50 border border-amber-300 text-amber-950 shadow-2xs transition inline-flex items-center gap-1.5 text-xs font-medium"
                  title={`Cotización Dólar Blue: ${dolarModoManual ? 'Modo Manual' : 'Auto diario'} · Act. ${formatDolarTime(blueInfo?.fechaActualizacion || blueInfo?.timestamp) || '12:00'} · Fuente: DolarApi.com / Ámbito`}
                >
                  <DollarSign className="w-3.5 h-3.5 text-amber-800 shrink-0" />

                  {!dolarModoManual ? (
                    <span
                      onClick={() => {
                        setDolarModoManual(true);
                        try { localStorage.setItem('sanjose_dolar_manual_locked', 'manual'); } catch {}
                      }}
                      className="font-black text-xs text-slate-900 tracking-tight tabular-nums select-none cursor-pointer hover:text-amber-800 transition hover:underline"
                      title="Cotización oficial automática del día (clic para fijar o editar manualmente)"
                    >
                      $ {Number(dolarRef || 1600).toLocaleString('es-AR')}
                    </span>
                  ) : (
                    <div className="inline-flex items-center gap-0.5">
                      <span className="text-xs font-bold text-amber-900">$</span>
                      <NumericInput
                        id="global-dolar-ref"
                        value={dolarRef}
                        onChange={(val) => handleChangeDolarRef(val)}
                        allowDecimals={true}
                        maxDecimals={2}
                        className="w-20 h-6 bg-white px-1.5 rounded-lg border border-amber-400 font-extrabold text-xs text-slate-900 text-right focus:outline-none focus:ring-1 focus:ring-amber-600 tabular-nums shadow-inner"
                        title="Tipo de Cambio manual ($/USD)"
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Sub-texto sutil de Compra y Venta (visible solo en 2xl para no saturar Tablet ni PC) */}
                  {blueInfo && (
                    <span
                      className="hidden 2xl:inline-block text-[10px] font-semibold text-amber-800/80 pl-1 border-l border-amber-300/80 whitespace-nowrap tabular-nums"
                      title={`Dólar Blue en Vivo\nCompra: $${Number(blueInfo.compra || 0).toLocaleString('es-AR')}\nVenta: $${Number(blueInfo.venta || 0).toLocaleString('es-AR')}`}
                    >
                      C: ${Number(blueInfo.compra || 0).toLocaleString('es-AR')} · V: ${Number(blueInfo.venta || 0).toLocaleString('es-AR')}
                    </span>
                  )}

                  {/* Botón Candado */}
                  <button
                    type="button"
                    onClick={handleToggleDolarCandado}
                    className={`p-1 rounded-lg transition active:scale-90 cursor-pointer ${
                      dolarModoManual
                        ? 'bg-amber-200/90 text-amber-950 hover:bg-amber-300 border border-amber-400'
                        : 'text-amber-800/70 hover:text-amber-950 hover:bg-amber-200/50'
                    }`}
                    title={
                      dolarModoManual
                        ? 'Candado abierto: Modo manual activado. Clic para volver a cotización automática.'
                        : 'Candado cerrado: Auto-actualización diaria activa. Clic para editar el valor.'
                    }
                  >
                    {dolarModoManual ? (
                      <Unlock className="w-3 h-3 text-amber-900" />
                    ) : (
                      <Lock className="w-3 h-3 text-amber-800" />
                    )}
                  </button>

                  {/* Ícono de refresco */}
                  <button
                    type="button"
                    onClick={() => handleActualizarBlue(true)}
                    disabled={actualizandoBlue}
                    className="p-1 rounded-lg text-amber-800/70 hover:text-amber-950 hover:bg-amber-200/50 transition active:scale-90 disabled:opacity-40 cursor-pointer"
                    title="Refrescar cotización del Dólar Blue ahora"
                  >
                    <RefreshCw className={`w-3 h-3 text-amber-900 ${actualizandoBlue ? 'animate-spin' : ''}`} />
                  </button>

                  {/* Ícono discreto de fuente */}
                  <button
                    type="button"
                    onClick={() => setShowFuenteTooltip((prev) => !prev)}
                    className="p-1 rounded-lg text-amber-800/70 hover:text-amber-950 hover:bg-amber-200/50 transition cursor-pointer"
                    title="Ver detalles de fuente DolarApi.com / Ámbito"
                  >
                    <span className="text-[10px] font-bold">ℹ️</span>
                  </button>
                </div>

                {/* Tooltip Flotante Absoluto de Fuente */}
                {showFuenteTooltip && (
                  <div className="absolute top-full left-0 mt-1.5 z-50 p-2.5 rounded-xl bg-slate-900 text-white text-[11px] shadow-xl border border-slate-700 w-56 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-1 mb-1.5">
                      <span className="font-extrabold text-amber-400">Fuente Dólar Blue</span>
                      <button
                        type="button"
                        onClick={() => setShowFuenteTooltip(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-tight mb-2">
                      Cotización en tiempo real vía <strong>DolarApi.com</strong> con fallback oficial y datos cruzados de Ámbito Financiero.
                    </p>
                    <div className="flex items-center justify-between text-[9px] pt-1 border-t border-slate-800">
                      <a
                        href="https://dolarapi.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:underline"
                      >
                        dolarapi.com ↗
                      </a>
                      <a
                        href="https://www.ambito.com/contenidos/dolar.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-400 hover:underline"
                      >
                        ambito.com ↗
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3.b PIZARRA HACIENDA DE REFERENCIA (MAG CAÑUELAS / ROSGAN) (Solo Modo Admin / Gestión) */}
            {appMode === 'admin' && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditandoPreciosHacienda({ ...preciosHacienda });
                    setShowPreciosHaciendaModal((prev) => !prev);
                  }}
                  className="h-8 px-2.5 py-1 rounded-xl bg-emerald-50/90 hover:bg-emerald-100/90 border border-emerald-300 text-emerald-950 shadow-2xs transition inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                  title="Pizarra de Precios de Hacienda (MAG Cañuelas / Rosgan) · Clic para ver o editar"
                >
                  <span className="text-xs">🐄</span>
                  <span className="font-extrabold text-xs text-slate-900 tracking-tight">
                    <span className="hidden xl:inline text-emerald-800">MAG: </span>
                    <span className="text-emerald-900 font-black">T: ${Number(preciosHacienda.ternero_kg_ars || 6300).toLocaleString('es-AR')}</span>
                    <span className="text-slate-400 mx-1">·</span>
                    <span className="text-slate-800 font-bold">V: ${Number(preciosHacienda.vaca_kg_ars || 3100).toLocaleString('es-AR')}</span>
                    <span className="hidden 2xl:inline">
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-700 font-semibold">Toro: ${Number(preciosHacienda.toro_kg_ars || 3300).toLocaleString('es-AR')}</span>
                    </span>
                  </span>
                  <Edit2 className="w-2.5 h-2.5 text-emerald-700 opacity-60" />
                </button>

                {/* Popover Flotante Global con z-[9999] para evitar cualquier recorte de overflow */}
                {showPreciosHaciendaModal && (
                  <div
                    className="fixed inset-0 z-[9999] flex items-start justify-center sm:justify-start sm:pl-64 lg:pl-72 pt-14 p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
                    onClick={() => setShowPreciosHaciendaModal(false)}
                  >
                    <div
                      className="relative w-full max-w-sm rounded-2xl bg-white text-slate-900 text-xs shadow-2xl border border-slate-200 p-4 space-y-3.5 select-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🐄</span>
                          <div>
                            <div className="font-black text-xs text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                              <span>Pizarra Hacienda (MAG / Rosgan)</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">Nov 2026</span>
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Precios $/kg vivo de referencia para el Copilot IA
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowPreciosHaciendaModal(false)}
                          className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                          title="Cerrar ventana"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                          <div>
                            <label className="text-xs font-bold text-slate-800 block">Ternero Invernada</label>
                            <span className="text-[10px] text-slate-500">160 - 180 kg</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 font-bold">$</span>
                            <NumericInput
                              value={editandoPreciosHacienda.ternero_kg_ars || ''}
                              onChange={(val) =>
                                setEditandoPreciosHacienda({
                                  ...editandoPreciosHacienda,
                                  ternero_kg_ars: val,
                                })
                              }
                              allowDecimals={false}
                              className="w-24 bg-white text-slate-900 font-black text-right px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs tabular-nums"
                            />
                            <span className="text-[10px] text-slate-500 font-mono">/kg</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                          <div>
                            <label className="text-xs font-bold text-slate-800 block">Novillito / Consumo</label>
                            <span className="text-[10px] text-slate-500">Gordo liviano</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 font-bold">$</span>
                            <NumericInput
                              value={editandoPreciosHacienda.novillito_kg_ars || ''}
                              onChange={(val) =>
                                setEditandoPreciosHacienda({
                                  ...editandoPreciosHacienda,
                                  novillito_kg_ars: val,
                                })
                              }
                              allowDecimals={false}
                              className="w-24 bg-white text-slate-900 font-black text-right px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs tabular-nums"
                            />
                            <span className="text-[10px] text-slate-500 font-mono">/kg</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                          <div>
                            <label className="text-xs font-bold text-slate-800 block">Vaca</label>
                            <span className="text-[10px] text-slate-500">Invernada / Descarte</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 font-bold">$</span>
                            <NumericInput
                              value={editandoPreciosHacienda.vaca_kg_ars || ''}
                              onChange={(val) =>
                                setEditandoPreciosHacienda({
                                  ...editandoPreciosHacienda,
                                  vaca_kg_ars: val,
                                })
                              }
                              allowDecimals={false}
                              className="w-24 bg-white text-slate-900 font-black text-right px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs tabular-nums"
                            />
                            <span className="text-[10px] text-slate-500 font-mono">/kg</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                          <div>
                            <label className="text-xs font-bold text-slate-800 block">Toro</label>
                            <span className="text-[10px] text-slate-500">Manufactura / Descarte</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500 font-bold">$</span>
                            <NumericInput
                              value={editandoPreciosHacienda.toro_kg_ars || ''}
                              onChange={(val) =>
                                setEditandoPreciosHacienda({
                                  ...editandoPreciosHacienda,
                                  toro_kg_ars: val,
                                })
                              }
                              allowDecimals={false}
                              className="w-24 bg-white text-slate-900 font-black text-right px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 text-xs tabular-nums"
                            />
                            <span className="text-[10px] text-slate-500 font-mono">/kg</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200 flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={consultandoPreciosIA}
                          onClick={handleConsultarHaciendaWebIA}
                          className="w-full py-2 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 font-bold text-xs border border-sky-200 flex items-center justify-center gap-2 transition active:scale-98 disabled:opacity-50 cursor-pointer shadow-2xs"
                          title="Consultar cotizaciones vigentes del MAG y remates en internet con Gemini IA"
                        >
                          {consultandoPreciosIA ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-600" />
                              <span>Buscando cotizaciones en la web...</span>
                            </>
                          ) : (
                            <>
                              <span>🌐 Consultar Referencia Web con IA</span>
                            </>
                          )}
                        </button>

                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setShowPreciosHaciendaModal(false)}
                            className="px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleGuardarPreciosHacienda}
                            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition active:scale-95 cursor-pointer shadow-sm flex items-center gap-1.5"
                          >
                            <span>✓ Guardar Precios</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* GRUPO DERECHA (MODOS Y ASISTENTE): TOGGLE PRODUCCIÓN/ADMIN, SANDBOX, COPILOTO IA */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 4. SWITCH GLOBAL: PRODUCCIÓN / ADMINISTRACIÓN */}
            <div className="h-8 p-0.5 rounded-xl bg-slate-100 border border-slate-300 shrink-0 inline-flex items-center shadow-2xs">
              <button
                type="button"
                onClick={() => {
                  setAppMode('produccion');
                  try {
                    localStorage.setItem('sanjose_app_mode', 'produccion');
                  } catch {}
                  if (activeTab === 'costos') navigateTab('inicio');
                  notify('Modo Producción activado.', 'info');
                }}
                className={`h-full px-2 py-0.5 rounded-lg text-xs font-medium flex items-center gap-1 transition whitespace-nowrap cursor-pointer ${
                  appMode === 'produccion'
                    ? 'bg-emerald-800 text-white font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Modo Producción"
              >
                <Tractor className="w-3.5 h-3.5 shrink-0" />
                <span>Producción</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (appMode === 'admin') return;
                  setPinInput('');
                  setPinError(false);
                  openModal('pin');
                }}
                className={`h-full px-2 py-0.5 rounded-lg text-xs font-medium flex items-center gap-1 transition whitespace-nowrap cursor-pointer ${
                  appMode === 'admin'
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Modo Administración (requiere PIN)"
              >
                {appMode === 'admin' ? (
                  <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span>Admin</span>
              </button>
            </div>

            {/* 5. TOGGLE MODO SANDBOX */}
            <button
              type="button"
              onClick={handleToggleSandbox}
              className={`h-8 px-2.5 py-0.5 rounded-xl text-xs font-bold shadow-2xs transition whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${
                isSandboxMode
                  ? 'bg-amber-500 text-amber-950 border border-amber-600 animate-pulse'
                  : 'bg-white hover:bg-amber-50 text-slate-700 border border-slate-300'
              }`}
              title={
                isSandboxMode
                  ? 'Modo Sandbox Activo: Todos los cambios son locales y no impactan en Supabase. Clic para salir.'
                  : 'Activar Modo Sandbox: Clona los datos localmente para probar cambios sin alterar Supabase.'
              }
            >
              <FlaskConical className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>{isSandboxMode ? 'Sandbox ACTIVO' : 'Sandbox'}</span>
            </button>

            {/* 6. BOTÓN PRINCIPAL COPILOTO IA */}
            <button
              type="button"
              onClick={() => openModal('copiloto')}
              className="h-8 px-3 rounded-xl bg-purple-950 hover:bg-purple-900 text-purple-200 border border-purple-700 text-xs font-bold shadow-xs transition whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer active:scale-95"
              title="Abrir Copiloto IA San José (Atajo: Ctrl + K / Cmd + K)"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span>✨ Copiloto IA</span>
              <kbd className="hidden xl:inline text-[9px] bg-purple-900/80 text-purple-300 px-1 py-0.5 rounded border border-purple-700/60 font-mono">
                Ctrl K
              </kbd>
            </button>
          </div>
        </header>

        {/* BANNER PERSISTENTE MODO SANDBOX */}
        {isSandboxMode && (
          <div className="bg-amber-500 text-amber-950 px-4 sm:px-6 py-2 text-xs font-black flex items-center justify-between shadow-sm border-b border-amber-600 sticky top-12 z-20">
            <div className="flex items-center gap-2">
              <span className="text-base">🧪</span>
              <span>
                MODO SANDBOX ACTIVO — Los cambios son simulados en memoria local y NO alteran la base de datos de producción en Supabase.
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleSandbox}
              className="px-3 py-1 bg-amber-950 hover:bg-black text-amber-200 hover:text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer shrink-0 ml-3"
            >
              Salir de Sandbox
            </button>
          </div>
        )}

        <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-8 pt-4 pb-28 sm:py-6 space-y-6">
          {syncError && (
            <div className="bg-red-50 border border-red-300 text-red-900 rounded-xl p-4 text-xs flex items-center justify-between">
              <div>
                <strong>Error de conexión con Supabase:</strong> {syncError}
              </div>
              <button
                type="button"
                onClick={fetchAllData}
                className="px-3 py-1 rounded-lg bg-red-700 text-white font-semibold"
              >
                Reintentar
              </button>
            </div>
          )}

          {activeTab === 'inicio' && (
            <TableroInicioView
              potreros={potreros}
              molinos={molinos}
              infraestructura={infraestructura}
              alertasMapa={alertasMapa}
              tareas={tareas}
              rodeos={rodeos}
              movimientosHacienda={movimientosHacienda}
              eventosSanitarios={eventosSanitarios}
              proveedoresEsperados={proveedoresEsperados}
              animales={animales}
              cajasCaravanas={cajasCaravanas}
              laboresSiembras={laboresSiembras}
              gastos={gastosCampo}
              ventas={ventasHacienda}
              campanaKpi={campanasKpis[0] || null}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1540}
          dolarModoManual={dolarModoManual}
          preciosHacienda={preciosHacienda}
              appMode={appMode}
              registrosLluvias={registrosLluvias}
              caminosEstado={caminosEstado}
              onChangeCaminosEstado={handleChangeCaminosEstado}
              onNavigate={navigateTab}
              onSelectPotreroInMap={handleSelectPotreroInMap}
              onSelectInfraInMap={handleSelectInfraInMap}
              onOpenCuadrilla={(routeOrMode, view) => {
                const isObj = routeOrMode && typeof routeOrMode === 'object';
                const mode = typeof routeOrMode === 'string' ? routeOrMode : (isObj && routeOrMode.tipo === 'RECORRIDA_GANADERA' ? 'GANADERA' : 'CUADRILLA');
                const initialView = view || (isObj ? 'hoja' : 'seleccion');
                openModal('cuadrilla', mode, initialView);
              }}
              activeCuadrillaRoute={activeCuadrillaRoute}
              onClearCuadrillaRoute={handleClearCuadrillaRoute}
              onOpenCopiloto={() => openModal('copiloto')}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {/* Mapa Vivo cacheado en DOM para carga instantánea al cambiar de pestaña */}
          <div className={activeTab === 'mapa' ? 'block' : 'hidden'}>
            <MapaPotrerosView
              potreros={potreros}
              setPotreros={setPotreros}
              molinos={molinos}
              infraestructura={infraestructura}
              setInfraestructura={setInfraestructura}
              alertasMapa={alertasMapa}
              caminos={caminos}
              rodeos={rodeos}
              animales={animales}
              siembras={laboresSiembras}
              fechaOperacion={fechaOperacion}
              isSandboxMode={isSandboxMode}
              initialSelectedPotreroNum={initialSelectedPotreroNum}
              initialTargetInfra={initialTargetInfra}
              onClearInitialPotrero={() => setInitialSelectedPotreroNum(null)}
              onClearTargetInfra={() => setInitialTargetInfra(null)}
              onCreateTareaFromItem={handleCreateTareaFromItem}
              onOpenCuadrilla={(routeOrMode, view) => {
                const isObj = routeOrMode && typeof routeOrMode === 'object';
                const mode = typeof routeOrMode === 'string' ? routeOrMode : (isObj && routeOrMode.tipo === 'RECORRIDA_GANADERA' ? 'GANADERA' : 'CUADRILLA');
                const initialView = view || (isObj ? 'hoja' : 'seleccion');
                openModal('cuadrilla', mode, initialView);
              }}
              activeCuadrillaRoute={activeCuadrillaRoute}
              onClearCuadrillaRoute={handleClearCuadrillaRoute}
              onNavigate={navigateTab}
              onRefresh={fetchAllData}
              notify={notify}
              isVisible={activeTab === 'mapa'}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          </div>

          {activeTab === 'rodeos' && (
            <RodeosCaravanasView
              rodeos={rodeos}
              movimientosHacienda={movimientosHacienda}
              animales={animales}
              cajasCaravanas={cajasCaravanas}
              potreros={potreros}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1540}
              dolarModoManual={dolarModoManual}
              preciosHacienda={preciosHacienda}
              ventas={ventasHacienda}
              onSelectPotreroInMap={handleSelectPotreroInMap}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              onOpenRecorrida={(mode) => openModal('cuadrilla', mode || 'GANADERA')}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {activeTab === 'bitacora' && (
            <BitacoraMovimientosView
              movimientosHacienda={movimientosHacienda}
              laboresSiembras={laboresSiembras}
              eventosSanitarios={eventosSanitarios}
              tareas={tareas}
              bitacoraNotas={bitacoraNotas}
              potreros={potreros}
              rodeos={rodeos}
              fechaOperacion={fechaOperacion}
              onSelectPotreroInMap={handleSelectPotreroInMap}
              onNavigate={navigateTab}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {(activeTab === 'calendario' || activeTab === 'sanidad') && (
            <CalendarioSanitarioView
              eventosSanitarios={eventosSanitarios}
              rodeos={rodeos}
              siembras={laboresSiembras}
              tareas={tareas}
              proveedoresEsperados={proveedoresEsperados}
              potreros={potreros}
              fechaOperacion={fechaOperacion}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {activeTab === 'siembras' && (
            <SiembrasView
              siembras={laboresSiembras}
              potreros={potreros}
              rodeos={rodeos}
              stockInsumos={stockInsumos}
              gastos={gastosCampo}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1540}
          dolarModoManual={dolarModoManual}
          preciosHacienda={preciosHacienda}
              isSandboxMode={isSandboxMode}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {appMode === 'admin' && activeTab === 'costos' && (
            <CostosFinanzasView
              gastos={gastosCampo}
              ventas={ventasHacienda}
              laboresSiembras={laboresSiembras}
              balancesContables={balancesContables}
              rodeos={rodeos}
              potreros={potreros}
              animales={animales}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1600}
              blueInfo={blueInfo}
              onChangeDolarRef={handleChangeDolarRef}
              onActualizarBlue={handleActualizarBlue}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {appMode === 'admin' && activeTab === 'ventas' && (
            <VentasView
              ventas={ventasHacienda}
              rodeos={rodeos}
              potreros={potreros}
              animales={animales}
              dolarRef={Number(dolarRef) || 1600}
              fechaOperacion={fechaOperacion}
              notify={notify}
              onRefresh={fetchAllData}
            />
          )}

          {activeTab === 'maquinaria' && (
            <MaquinariaTallerView
              maquinaria={maquinaria}
              maquinariaRepuestos={maquinariaRepuestos}
              maquinariaServices={maquinariaServices}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1540}
          dolarModoManual={dolarModoManual}
          preciosHacienda={preciosHacienda}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {activeTab === 'tareas' && (
            <TareasCampoView
              tareas={tareas}
              potreros={potreros}
              rodeos={rodeos}
              infraestructura={infraestructura}
              fechaOperacion={fechaOperacion}
              draftTarea={draftTarea}
              onClearDraftTarea={() => setDraftTarea(null)}
              onSelectPotreroInMap={handleSelectPotreroInMap}
              onOpenCuadrilla={() => openModal('cuadrilla')}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {activeTab === 'insumos' && (
            <InsumosReservasView
              stockInsumos={stockInsumos}
              insumos={stockInsumos}
              movimientosInsumos={movimientosInsumos}
              proveedoresEsperados={proveedoresEsperados}
              maquinaria={maquinaria}
              fechaOperacion={fechaOperacion}
              dolarRef={Number(dolarRef) || 1540}
              dolarModoManual={dolarModoManual}
              preciosHacienda={preciosHacienda}
              onNavigate={navigateTab}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}

          {appMode === 'admin' && activeTab === 'informes' && (
            <InformesEjecutivosView
              potreros={potreros}
              rodeos={rodeos}
              animales={animales}
              cajasCaravanas={cajasCaravanas}
              movimientosHacienda={movimientosHacienda}
              gastos={gastosCampo}
              gastosCampo={gastosCampo}
              ventas={ventasHacienda}
              ventasHacienda={ventasHacienda}
              ingresos={ventasHacienda}
              despachosGasoil={despachosGasoil}
              registrosLluvias={registrosLluvias}
              registrosLluvia={registrosLluvias}
              lluvias={registrosLluvias}
              movimientosInsumos={movimientosInsumos}
              laboresSiembras={laboresSiembras}
              maquinaria={maquinaria}
              tareas={tareas}
              dolarRef={Number(dolarRef) || 1540}
          dolarModoManual={dolarModoManual}
          preciosHacienda={preciosHacienda}
              fechaOperacion={fechaOperacion}
              navContext={navContext}
              onClearNavContext={handleClearNavContext}
              onRefresh={fetchAllData}
              notify={notify}
              appMode={appMode}
              isAdmin={appMode === 'admin'}
            />
          )}
        </main>
      </div>

      {/* MODAL: CARGA RÁPIDA (SPRINT L) */}
      {showCargaRapidaModal && (
        <div
          className="fixed inset-0 z-[1000] bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={() => setShowCargaRapidaModal(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-slate-950 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-slate-950 text-amber-400 shadow-md">
                  <Zap className="w-6 h-6 fill-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-black leading-tight tracking-tight text-slate-950">
                    Carga Rápida de Campo
                  </h3>
                  <p className="text-xs font-bold text-slate-900/80">
                    Atajos directos para operar en San José
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCargaRapidaModal(false)}
                className="p-1.5 rounded-xl bg-slate-950/10 hover:bg-slate-950/20 text-slate-950 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Opciones de Carga Rápida */}
            <div className="p-5 space-y-3 bg-slate-50/50">
              {/* Opción 1: Escanear Factura / PDF */}
              <button
                type="button"
                onClick={() => {
                  setShowCargaRapidaModal(false);
                  navigateTab('costos', { action: 'escanear_factura' });
                }}
                className="w-full text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-emerald-600 hover:shadow-md transition group flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 group-hover:bg-emerald-800 group-hover:text-white transition">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-emerald-900 transition">
                      📄 Escanear Factura / PDF
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Escáner inteligente Gemini IA para comprobantes y remitos
                    </p>
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-emerald-700 font-black text-base transition">
                  →
                </span>
              </button>

              {/* Opción 2: Movimiento de Hacienda */}
              <button
                type="button"
                onClick={() => {
                  setShowCargaRapidaModal(false);
                  navigateTab('rodeos', { action: 'nuevo_movimiento' });
                }}
                className="w-full text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-sky-600 hover:shadow-md transition group flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-xl bg-sky-50 text-sky-800 border border-sky-200 group-hover:bg-sky-800 group-hover:text-white transition">
                    <span className="text-lg">🐄</span>
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-sky-900 transition">
                      Movimiento de Hacienda
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Cambio de potrero, pesaje, aparte o salida de tropa
                    </p>
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-sky-700 font-black text-base transition">
                  →
                </span>
              </button>

              {/* Opción 3: Nueva Tarea / Recordatorio */}
              <button
                type="button"
                onClick={() => {
                  setShowCargaRapidaModal(false);
                  navigateTab('tareas', { action: 'nueva_tarea' });
                }}
                className="w-full text-left p-4 rounded-2xl bg-white border border-slate-200 hover:border-purple-600 hover:shadow-md transition group flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-xl bg-purple-50 text-purple-800 border border-purple-200 group-hover:bg-purple-800 group-hover:text-white transition">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-purple-900 transition">
                      ✅ Nueva Tarea / Recordatorio
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Asignar labor operativa para la cuadrilla o encargado
                    </p>
                  </div>
                </div>
                <span className="text-slate-300 group-hover:text-purple-700 font-black text-base transition">
                  →
                </span>
              </button>
            </div>

            {/* Pie del modal */}
            <div className="p-3.5 bg-slate-100 border-t border-slate-200 text-center">
              <span className="text-[11px] text-slate-500 font-semibold">
                Establecimiento San José · Carga directa sin fricción
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODAL / SLIDE-OVER: COPILOTO OPERATIVO SAN JOSÉ (GEMINI IA) */}
      {showCopilotoModal && (
        <CopilotoSanJoseDrawer
          isOpen={true}
          onClose={() => setShowCopilotoModal(false)}
          potreros={potreros}
          rodeos={rodeos}
          tareas={tareas}
          alertas={alertasMapa}
          registrosLluvias={registrosLluvias}
          insumos={stockInsumos}
          maquinaria={maquinaria}
          gastos={gastosCampo}
          ventas={ventasHacienda}
          laboresSiembras={laboresSiembras}
          fechaOperacion={fechaOperacion}
          dolarRef={Number(dolarRef) || 1540}
          dolarModoManual={dolarModoManual}
          preciosHacienda={preciosHacienda}
          activeTab={activeTab}
          caminosEstado={caminosEstado}
          isSandboxMode={isSandboxMode}
          onRefresh={fetchAllData}
          notify={notify}
        />
      )}

      {/* MODAL: PLANIFICADOR DE DÍA DE CUADRILLA */}
      {showCuadrillaModal && (
        <CuadrillaPlannerModal
          isOpen={true}
          onClose={() => setShowCuadrillaModal(false)}
          tareas={tareas}
          alertasMapa={alertasMapa}
          molinos={molinos}
          potreros={potreros}
          rodeos={rodeos}
          infraestructura={infraestructura}
          fechaOperacion={fechaOperacion}
          initialMode={cuadrillaModalMode}
          initialView={cuadrillaInitialView}
          activeRoute={activeCuadrillaRoute}
          onSaveRoute={handleSaveCuadrillaRoute}
          onClearRoute={handleClearCuadrillaRoute}
          onViewRouteInMap={(plan) => {
            handleSaveCuadrillaRoute(plan);
            setShowCuadrillaModal(false);
            setActiveTab('mapa');
          }}
          notify={notify}
        />
      )}

      {/* MODAL: PUNTOS DE RESTAURACIÓN Y RESPALDOS */}
      {showSnapshotsModal && (
        <SystemSnapshotsModal
          isOpen={true}
          onClose={() => setShowSnapshotsModal(false)}
          onRestoreSuccess={fetchAllData}
          notify={notify}
          onNavigate={(targetTab, params) => {
            setShowSnapshotsModal(false);
            navigateTab(targetTab, params);
          }}
        />
      )}

      {/* GLOBO FLOTANTE MINI (FAB) COPILOTO IA EN CELULAR (< 768px) */}
      {!showCopilotoModal && (
        <button
          type="button"
          onClick={() => openModal('copiloto')}
          aria-label="Abrir Copiloto IA"
          className="md:hidden fixed bottom-5 right-4 z-40 w-11 h-11 rounded-full bg-emerald-950 hover:bg-emerald-900 text-white shadow-lg border border-emerald-500/40 flex items-center justify-center transition active:scale-90 cursor-pointer"
          title="Copiloto IA San José"
        >
          <Sparkles className="w-5 h-5 text-amber-300" />
        </button>
      )}
      {/* DIÁLOGO GLOBAL DE CONFIRMACIÓN PROPIO DE LA APP */}
      <ConfirmDialog />
    </div>
  );
}
