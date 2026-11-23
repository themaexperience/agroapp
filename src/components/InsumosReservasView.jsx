import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Boxes,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Search,
  Fuel,
  Wheat,
  Activity,
  Layers,
  Sparkles,
  Calendar,
  Clock,
  X,
  Trash2,
  Edit,
  Truck,
  Building2,
  Store,
  ShieldCheck,
  RotateCcw,
  Camera,
  Check,
  Loader2,
  ShieldAlert,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR, calcularRangoSemanal, formatRangoProveedorAR } from '../utils/dateHelper';
import GeminiPlanillaGasoilModal from './GeminiPlanillaGasoilModal';
import { analizarMedicamentoVeterinarioIA } from '../lib/geminiService';
import { confirmAction } from './ConfirmDialog';

export const CATEGORIAS_INSUMOS = [
  'Combustible',
  'Rollos / Forraje',
  'Granos / Suplementos',
  'Sales Minerales',
  'Sanidad',
  'Agroquímicos',
  'Semillas / Pasturas',
  'Alambrados / Infraestructura',
  'Repuestos / Taller',
];

export const UNIDADES_INSUMOS = [
  'Unidades',
  'Rollos',
  'Metros',
  'Litros',
  'Kg',
  'Toneladas',
  'Bolsas 25kg',
  'Bolsas 40kg',
  'Frascos',
  'Ampollas',
  'Cajas',
  'Dosis',
  'Camionadas / Viajes',
];

export function calcularBadgeVencimiento(fechaVenc) {
  if (!fechaVenc) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(fechaVenc);
  if (isNaN(venc.getTime())) return null;
  venc.setHours(0, 0, 0, 0);

  const diffTime = venc.getTime() - hoy.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      text: `Venció hace ${Math.abs(diffDays)}d`,
      color: 'bg-red-100 text-red-900 border border-red-300 font-extrabold',
      estado: 'VENCIDO',
      dias: diffDays,
    };
  }
  if (diffDays <= 30) {
    return {
      text: `Vence en ${diffDays}d`,
      color: 'bg-red-50 text-red-800 border border-red-300 font-extrabold',
      estado: 'CRITICO',
      dias: diffDays,
    };
  }
  if (diffDays <= 60) {
    return {
      text: `Vence en ${diffDays}d`,
      color: 'bg-amber-100 text-amber-900 border border-amber-300 font-bold',
      estado: 'ADVERTENCIA',
      dias: diffDays,
    };
  }
  return {
    text: `Vence: ${venc.toLocaleDateString('es-AR')}`,
    color: 'bg-slate-100 text-slate-700 border border-slate-200',
    estado: 'VIGENTE',
    dias: diffDays,
  };
}

// Catálogo base de referencia veterinaria San José
export const CATALOGO_VETERINARIO_BASE = [
  // Disponibilidad permanente
  { nombre: 'Maxibiotic L.A. 250ml', categoria: 'Sanidad', unidad: 'Frascos', min: 3, tipo: 'PERMANENTE', dosis: '1 ml/10 kg' },
  { nombre: 'Dexametasona Ampolla', categoria: 'Sanidad', unidad: 'Ampollas', min: 5, tipo: 'PERMANENTE', dosis: '1 ampolla' },
  { nombre: 'Sulfaprim 100/250ml', categoria: 'Sanidad', unidad: 'Frascos', min: 2, tipo: 'PERMANENTE', dosis: '15 ml/100 kg' },
  { nombre: 'Magnecal Plus 500ml', categoria: 'Sanidad', unidad: 'Frascos', min: 2, tipo: 'PERMANENTE', dosis: '100 ml/cab' },
  { nombre: 'Magnecal 3000 100ml', categoria: 'Sanidad', unidad: 'Frascos', min: 2, tipo: 'PERMANENTE', dosis: '20 ml/cab' },
  { nombre: 'Agujas 13x18 (caja x 12)', categoria: 'Sanidad', unidad: 'Cajas', min: 2, tipo: 'PERMANENTE', dosis: 'Descartable' },
  { nombre: 'Jeringas automáticas 50cm', categoria: 'Sanidad', unidad: 'Unidades', min: 2, tipo: 'PERMANENTE', dosis: 'Instrumental' },
  { nombre: 'Agujas cono rosa', categoria: 'Sanidad', unidad: 'Unidades', min: 20, tipo: 'PERMANENTE', dosis: 'Descartable' },
  { nombre: 'Jeringas 20ml', categoria: 'Sanidad', unidad: 'Unidades', min: 10, tipo: 'PERMANENTE', dosis: 'Instrumental' },

  // Estacionales según calendario
  { nombre: 'Bioclostrigen', categoria: 'Sanidad', unidad: 'Dosis', min: 0, tipo: 'ESTACIONAL', dosis: '2 ml/cab', epoca: 'Oct/Nov y Marzo (Terneros)' },
  { nombre: 'Biopoligen HS/Q', categoria: 'Sanidad', unidad: 'Dosis', min: 0, tipo: 'ESTACIONAL', dosis: '5 ml/cab', epoca: 'Oct/Nov y Marzo (Terneros)' },
  { nombre: 'Bagomectina 500ml', categoria: 'Sanidad', unidad: 'Frascos', min: 0, tipo: 'ESTACIONAL', dosis: '1 cm/50 kg', epoca: 'Destete y Entrada Invierno' },
  { nombre: 'Paraxane 1L', categoria: 'Sanidad', unidad: 'Litros', min: 0, tipo: 'ESTACIONAL', dosis: '10 ml/100 kg', epoca: 'Fin de Primavera / Verano' },
  { nombre: 'Suplenut Se 500ml', categoria: 'Sanidad', unidad: 'Frascos', min: 0, tipo: 'ESTACIONAL', dosis: '5 cm/cab', epoca: 'Tacto Mar-Abr, Preparto Jun, Preservicio Sep' },
  { nombre: 'Rotatec J5', categoria: 'Sanidad', unidad: 'Dosis', min: 0, tipo: 'ESTACIONAL', dosis: '3 ml/cab', epoca: 'Preparto Feb-Mar (Vaq) y Jun (Vacas)' },
];

export default function InsumosReservasView({
  insumos: rawInsumos = [],
  stockInsumos = [],
  movimientosInsumos = [],
  maquinaria = [],
  rodeos = [],
  potreros = [],
  fechaOperacion,
  dolarRef = 1540,
  onNavigate,
  navContext,
  onClearNavContext,
  onRefresh,
  notify,
}) {
  const insumos = rawInsumos && rawInsumos.length > 0 ? rawInsumos : stockInsumos || [];
  const [categoriaFilter, setCategoriaFilter] = useState('TODOS');
  const [ubicacionFilter, setUbicacionFilter] = useState('TODAS'); // 'TODAS' | 'En Campo' | 'En Proveedor'
  const [searchTerm, setSearchTerm] = useState('');
  const [showIngresoModal, setShowIngresoModal] = useState(false);
  const [showConsumoModal, setShowConsumoModal] = useState(false);
  const [lockedInsumo, setLockedInsumo] = useState(null);
  const [showNewInsumoModal, setShowNewInsumoModal] = useState(false);
  const [showGasoilModal, setShowGasoilModal] = useState(false);
  const [selectedInsumo, setSelectedInsumo] = useState(null);
  const [editingInsumo, setEditingInsumo] = useState(null);
  const [retiroModal, setRetiroModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showGalponAcciones, setShowGalponAcciones] = useState(false);

  // Solapa principal: 'stock' | 'sanidad_catalogo' | 'proveedores_esperados'
  const [vistaTab, setVistaTab] = useState('stock');

  // Deep-linking desde Calendario u otros módulos
  React.useEffect(() => {
    if (navContext?.subTab === 'proveedores' || navContext?.subTab === 'proveedores_esperados') {
      setVistaTab('proveedores_esperados');
      onClearNavContext?.();
    }
  }, [navContext, onClearNavContext]);

  // Proveedores y servicios esperados
  const [proveedoresEsperados, setProveedoresEsperados] = useState([]);
  const [loadingProveedores, setLoadingProveedores] = useState(false);
  const [showNewProveedorModal, setShowNewProveedorModal] = useState(false);
  const [editingProveedor, setEditingProveedor] = useState(null);
  const [proveedorForm, setProveedorForm] = useState({
    proveedor_o_rubro: 'Piedra / Tosca',
    indicaciones: '',
    modalidad_fecha: 'semana', // 'dia' | 'semana'
    semana_estimada: '',
    semana_fin: '',
    cantidad_semanas: 1,
    estado: 'Esperando',
    notas: '',
  });

  // Escaneo IA de medicamentos
  const [analyzingVetIa, setAnalyzingVetIa] = useState(false);
  const vetIaInputRef = useRef(null);

  // Forms
  const [movForm, setMovForm] = useState({
    insumo_id: '',
    cantidad: '',
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    destino: '',
    potrero_numero: '',
    maquinaria_id: '',
    responsable: '',
    observaciones: '',
  });

  const [newInsumoForm, setNewInsumoForm] = useState({
    categoria: 'Sanidad',
    nombre: '',
    unidad: 'Frascos',
    cantidad_actual: '',
    stock_campo: '',
    stock_cooperativa: '',
    ubicacion_tipo: 'En Campo',
    cantidad_minima_alerta: '',
    ubicacion: 'Botiquín Veterinario Casco',
    precio_unitario_ref: '',
    moneda: 'ARS',
    fecha_vencimiento: '',
    lote: '',
    dosis_por_animal: '',
    observaciones: '',
  });

  // KPIs
  const kpis = useMemo(() => {
    const gasoil = insumos.find((i) => i.categoria === 'Combustible') || { cantidad_actual: 0 };
    // Asegurar que sume EXCLUSIVAMENTE ítems de Rollos / Forraje (nunca rollos de alambre ni infraestructura)
    const rollos = insumos
      .filter((i) => {
        const cat = (i.categoria || '').trim();
        if (
          cat.includes('Alambrados') ||
          cat.includes('Infraestructura') ||
          cat.includes('Repuestos') ||
          cat.includes('Taller')
        ) {
          return false;
        }
        return cat === 'Rollos / Forraje' || cat === 'Forraje' || cat.toLowerCase().includes('forraje');
      })
      .reduce((acc, i) => acc + Number(i.cantidad_actual || 0), 0);

    const granos = insumos
      .filter((i) => i.categoria === 'Granos / Suplementos')
      .reduce((acc, i) => acc + Number(i.cantidad_actual || 0), 0);
    const bajoMinimo = insumos.filter(
      (i) => Number(i.cantidad_actual || 0) <= Number(i.cantidad_minima_alerta || 0)
    );
    const enProveedorItems = insumos.filter(
      (i) => Number(i.stock_cooperativa || 0) > 0 || i.ubicacion_tipo?.includes('Cooperativa') || i.ubicacion_tipo?.includes('Proveedor')
    );

    return {
      gasoilLitros: Number(gasoil.cantidad_actual) || 0,
      rollosTotal: rollos,
      granosKg: granos,
      itemsBajoMinimo: bajoMinimo.length,
      bajoMinimoList: bajoMinimo,
      itemsEnProveedor: enProveedorItems.length,
      itemsEnCooperativa: enProveedorItems.length,
    };
  }, [insumos]);

  const filteredInsumos = useMemo(() => {
    return insumos.filter((item) => {
      const matchCat =
        categoriaFilter === 'TODOS' ||
        item.categoria === categoriaFilter ||
        (categoriaFilter === 'Alambrados / Infraestructura' &&
          (item.categoria === 'Infraestructura / Alambrados' || item.categoria === 'Alambrados'));
      const stCampo = Number(item.stock_campo || 0);
      const stCoop = Number(item.stock_cooperativa || 0);

      const matchUbicacion =
        ubicacionFilter === 'TODAS' ||
        (ubicacionFilter === 'En Campo' && (stCampo > 0 || item.ubicacion_tipo === 'En Campo' || item.ubicacion_tipo === 'En Campo (Galpón)')) ||
        ((ubicacionFilter === 'En Proveedor' || ubicacionFilter === 'En Cooperativa (Pendiente de retiro)') &&
          (stCoop > 0 || item.ubicacion_tipo?.includes('Cooperativa') || item.ubicacion_tipo?.includes('Proveedor')));

      const matchSearch =
        searchTerm === '' ||
        item.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.ubicacion && item.ubicacion.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchCat && matchUbicacion && matchSearch;
    });
  }, [insumos, categoriaFilter, ubicacionFilter, searchTerm]);

  // Cargar Proveedores Esperados desde Supabase
  const loadProveedoresEsperados = async () => {
    setLoadingProveedores(true);
    try {
      const { data, error } = await supabase
        .from('proveedores_esperados')
        .select('*')
        .order('semana_estimada', { ascending: true });
      if (error) throw error;
      setProveedoresEsperados(data || []);
    } catch (err) {
      console.warn('Error cargando proveedores esperados:', err);
    } finally {
      setLoadingProveedores(false);
    }
  };

  React.useEffect(() => {
    loadProveedoresEsperados();
  }, []);

  // Guardar o Actualizar Proveedor Esperado
  async function handleSaveProveedorEsperado(e) {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      let fInicio = proveedorForm.semana_estimada;
      let fFin = null;

      if (proveedorForm.modalidad_fecha === 'semana') {
        if (!fInicio) {
          const calc = calcularRangoSemanal(new Date(), 0, proveedorForm.cantidad_semanas || 1);
          fInicio = calc.fechaInicio;
          fFin = calc.fechaFin;
        } else if (!proveedorForm.semana_fin) {
          const calc = calcularRangoSemanal(fInicio, 0, proveedorForm.cantidad_semanas || 1);
          fFin = calc.fechaFin;
        } else {
          fFin = proveedorForm.semana_fin;
        }
      } else {
        fFin = null;
      }

      const payload = {
        proveedor_o_rubro: proveedorForm.proveedor_o_rubro?.trim() || 'Servicio',
        indicaciones: proveedorForm.indicaciones?.trim() || null,
        semana_estimada: fInicio || new Date().toISOString().slice(0, 10),
        semana_fin: fFin,
        estado: proveedorForm.estado || 'Esperando',
        notas: proveedorForm.notas?.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingProveedor) {
        const { error } = await supabase
          .from('proveedores_esperados')
          .update(payload)
          .eq('id', editingProveedor.id);
        if (error) throw error;
        notify?.('Llegada de proveedor/servicio actualizada.', 'success');
      } else {
        const { error } = await supabase.from('proveedores_esperados').insert(payload);
        if (error) throw error;
        notify?.('Proveedor o servicio agendado con éxito.', 'success');
      }

      setShowNewProveedorModal(false);
      setEditingProveedor(null);
      await loadProveedoresEsperados();
    } catch (err) {
      notify?.('Error guardando proveedor esperado: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Eliminar Proveedor Esperado
  async function handleDeleteProveedor(id) {
    const ok = await confirmAction({
      title: '¿Eliminar registro de proveedor/servicio?',
      description: 'Esta acción cancelará el seguimiento de este proveedor o servicio esperado.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('proveedores_esperados').delete().eq('id', id);
      if (error) throw error;
      notify?.('Registro eliminado.', 'success');
      await loadProveedoresEsperados();
    } catch (err) {
      notify?.('Error al eliminar: ' + err.message, 'error');
    }
  }

  // Marcar rápido proveedor/servicio como Recibido
  async function handleMarcarProveedorRecibido(prov) {
    try {
      const { error } = await supabase
        .from('proveedores_esperados')
        .update({ estado: 'Recibido', updated_at: new Date().toISOString() })
        .eq('id', prov.id);
      if (error) throw error;
      notify?.(`Llegada de "${prov.proveedor_o_rubro}" marcada como Recibido.`, 'success');
      await loadProveedoresEsperados();
    } catch (err) {
      notify?.('Error actualizando estado: ' + err.message, 'error');
    }
  }

  // Inicializar ítems faltantes del catálogo veterinario base en 1 clic
  async function handleInicializarCatalogoVeterinario() {
    setSaving(true);
    try {
      const existingNames = new Set(insumos.map((i) => i.nombre.trim().toLowerCase()));
      const toInsert = CATALOGO_VETERINARIO_BASE.filter(
        (c) => !existingNames.has(c.nombre.trim().toLowerCase())
      ).map((c) => ({
        categoria: 'Sanidad',
        nombre: c.nombre,
        unidad: c.unidad,
        cantidad_actual: 0,
        stock_campo: 0,
        stock_cooperativa: 0,
        ubicacion_tipo: 'En Campo',
        cantidad_minima_alerta: c.min || 0,
        ubicacion: 'Botiquín Veterinario Casco',
        tipo_gestion: c.tipo,
        dosis_por_animal: c.dosis,
        precio_unitario_ref: 0,
        moneda: 'ARS',
        observaciones: c.epoca ? `Uso: ${c.epoca}` : 'Botiquín veterinario permanente',
      }));

      if (toInsert.length === 0) {
        notify?.('Todos los ítems del catálogo veterinario ya existen en el stock.', 'info');
        setSaving(false);
        return;
      }

      const { error } = await supabase.from('stock_insumos').insert(toInsert);
      if (error) throw error;

      notify?.(`¡Se inicializaron ${toInsert.length} medicamentos en el botiquín veterinario!`, 'success');
      await onRefresh?.();
    } catch (err) {
      notify?.('Error inicializando catálogo: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Escaneo IA de Medicamentos Veterinarios (Etiqueta o Remito/Factura)
  async function handleScanMedicamentoIA(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setAnalyzingVetIa(true);
    try {
      notify?.('Analizando etiqueta o remito veterinario con Gemini IA...', 'info');
      const data = await analizarMedicamentoVeterinarioIA(file);
      if (data) {
        setNewInsumoForm((prev) => ({
          ...prev,
          categoria: 'Sanidad',
          nombre: data.nombre || prev.nombre,
          unidad: data.unidad || prev.unidad,
          cantidad_actual: data.cantidad != null ? data.cantidad : prev.cantidad_actual,
          stock_campo: data.cantidad != null ? data.cantidad : prev.stock_campo,
          stock_cooperativa: 0,
          ubicacion_tipo: 'En Campo',
          lote: data.lote || prev.lote,
          fecha_vencimiento: data.fecha_vencimiento || prev.fecha_vencimiento,
          dosis_por_animal: data.dosis_por_animal || prev.dosis_por_animal,
          precio_unitario_ref: data.precio_unitario_ref || prev.precio_unitario_ref,
          moneda: data.moneda || prev.moneda,
          observaciones: data.observaciones || prev.observaciones,
        }));
        setShowNewInsumoModal(true);
        notify?.('¡Datos del medicamento extraídos exitosamente!', 'success');
      }
    } catch (err) {
      console.error('Error con IA:', err);
      notify?.('Error analizando medicamento: ' + err.message, 'error');
    } finally {
      setAnalyzingVetIa(false);
      e.target.value = '';
    }
  }

  // Manejar Ingreso de Stock
  async function handleSaveIngreso(e) {
    if (e) e.preventDefault();
    if (!movForm.insumo_id || !movForm.cantidad) return;
    setSaving(true);
    try {
      const cant = Number(movForm.cantidad);
      const target = insumos.find((i) => i.id === Number(movForm.insumo_id));
      if (!target) throw new Error('Insumo no encontrado.');

      const stCampo = Number(target.stock_campo || target.cantidad_actual || 0) + cant;
      const stCoop = Number(target.stock_cooperativa || 0);
      const nuevaCantidad = stCampo + stCoop;

      // 1. Actualizar stock
      const { error: errUpdate } = await supabase
        .from('stock_insumos')
        .update({
          stock_campo: stCampo,
          cantidad_actual: nuevaCantidad,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      if (errUpdate) throw errUpdate;

      // 2. Registrar movimiento
      const { error: errMov } = await supabase.from('movimientos_insumos').insert({
        insumo_id: target.id,
        tipo: 'Ingreso / Compra',
        cantidad: cant,
        fecha: movForm.fecha || fechaOperacion,
        destino: movForm.destino || 'Reabastecimiento de stock en campo',
        responsable: movForm.responsable || null,
        observaciones: movForm.observaciones || null,
      });
      if (errMov) throw errMov;

      notify?.(`Ingreso de ${cant} ${target.unidad} a "${target.nombre}" registrado con éxito.`, 'success');
      setShowIngresoModal(false);
      setMovForm({
        insumo_id: '',
        cantidad: '',
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
        destino: '',
        potrero_numero: '',
        maquinaria_id: '',
        responsable: '',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar ingreso: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Manejar Consumo / Egreso de Stock
  async function handleSaveConsumo(e) {
    if (e) e.preventDefault();
    if (!movForm.insumo_id || !movForm.cantidad) return;
    setSaving(true);
    try {
      const cant = Number(movForm.cantidad);
      const target = insumos.find((i) => i.id === Number(movForm.insumo_id));
      if (!target) throw new Error('Insumo no encontrado.');

      const stCampoActual = Number(target.stock_campo || target.cantidad_actual || 0);
      const nuevoCampo = Math.max(0, stCampoActual - cant);
      const stCoop = Number(target.stock_cooperativa || 0);
      const nuevaCantidad = nuevoCampo + stCoop;

      // 1. Actualizar stock
      const { error: errUpdate } = await supabase
        .from('stock_insumos')
        .update({
          stock_campo: nuevoCampo,
          cantidad_actual: nuevaCantidad,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      if (errUpdate) throw errUpdate;

      // 2. Registrar movimiento
      const { error: errMov } = await supabase.from('movimientos_insumos').insert({
        insumo_id: target.id,
        tipo: 'Consumo / Egreso',
        cantidad: cant,
        fecha: movForm.fecha || fechaOperacion,
        destino: movForm.destino || 'Consumo operativo',
        potrero_numero: movForm.potrero_numero ? Number(movForm.potrero_numero) : null,
        maquinaria_id: movForm.maquinaria_id ? Number(movForm.maquinaria_id) : null,
        responsable: movForm.responsable || null,
        observaciones: movForm.observaciones || null,
      });
      if (errMov) throw errMov;

      notify?.(`Consumo de ${cant} ${target.unidad} descontado de "${target.nombre}".`, 'success');
      setShowConsumoModal(false);
      setMovForm({
        insumo_id: '',
        cantidad: '',
        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
        destino: '',
        potrero_numero: '',
        maquinaria_id: '',
        responsable: '',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar consumo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // EDICIÓN DIRECTA DE INSUMO (Sin obligar a movimiento compensatorio)
  async function handleSaveEditInsumo(e) {
    if (e) e.preventDefault();
    if (!editingInsumo) return;
    setSaving(true);
    try {
      const stCampo = Number(editingInsumo.stock_campo) || 0;
      const stCoop = Number(editingInsumo.stock_cooperativa) || 0;
      const cantTotal = stCampo + stCoop;

      const { error } = await supabase
        .from('stock_insumos')
        .update({
          nombre: editingInsumo.nombre?.trim(),
          categoria: editingInsumo.categoria,
          unidad: editingInsumo.unidad,
          stock_campo: stCampo,
          stock_cooperativa: stCoop,
          cantidad_actual: cantTotal,
          ubicacion_tipo:
            editingInsumo.ubicacion_tipo ||
            (stCoop > 0 && stCampo === 0
              ? 'En Proveedor (Pendiente de retiro)'
              : 'En Campo'),
          cantidad_minima_alerta: Number(editingInsumo.cantidad_minima_alerta) || 0,
          ubicacion: editingInsumo.ubicacion?.trim() || 'Galpón Casco',
          precio_unitario_ref: Number(editingInsumo.precio_unitario_ref) || 0,
          moneda: editingInsumo.moneda || 'ARS',
          observaciones: editingInsumo.observaciones?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingInsumo.id);

      if (error) throw error;
      notify?.(`Insumo "${editingInsumo.nombre}" actualizado correctamente.`, 'success');
      setEditingInsumo(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al actualizar insumo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ELIMINAR INSUMO DIRECTAMENTE (Para limpiar pruebas o saldos nulos)
  async function handleDeleteInsumo(item) {
    const ok = await confirmAction({
      title: `¿Eliminar "${item.nombre}"?`,
      description: 'Se eliminará permanentemente del inventario de pañol/galpón sin registrar movimiento compensatorio.',
      confirmText: 'Sí, eliminar del stock',
      variant: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('stock_insumos').delete().eq('id', item.id);
      if (error) throw error;
      notify?.(`Insumo "${item.nombre}" eliminado correctamente del stock.`, 'success');
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al eliminar insumo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ACCIÓN RÁPIDA: RETIRAR DE PROVEEDOR → CAMPO
  async function handleConfirmRetiro(e) {
    if (e) e.preventDefault();
    if (!retiroModal) return;
    const { insumo, cantidad, fecha, destino, responsable, observaciones } = retiroModal;
    const cantNum = Number(cantidad);
    const coopActual = Number(insumo.stock_cooperativa || 0);

    if (cantNum <= 0) {
      notify?.('Ingresá una cantidad mayor a 0 a retirar.', 'error');
      return;
    }
    if (cantNum > coopActual) {
      notify?.(
        `No podés retirar más de lo que hay en Proveedor (${coopActual} ${insumo.unidad}).`,
        'warning'
      );
      return;
    }

    setSaving(true);
    try {
      const nuevoCoop = coopActual - cantNum;
      const nuevoCampo = Number(insumo.stock_campo || 0) + cantNum;
      const nuevoTotal = nuevoCampo + nuevoCoop;

      // 1. Actualizar stock_insumos
      const { error: errUpd } = await supabase
        .from('stock_insumos')
        .update({
          stock_cooperativa: nuevoCoop,
          stock_campo: nuevoCampo,
          cantidad_actual: nuevoTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', insumo.id);
      if (errUpd) throw errUpd;

      // 2. Registrar movimiento de trazabilidad
      const { error: errMov } = await supabase.from('movimientos_insumos').insert({
        insumo_id: insumo.id,
        tipo: 'Retiro de Proveedor a Campo',
        cantidad: cantNum,
        fecha: fecha || fechaOperacion || new Date().toISOString().slice(0, 10),
        destino: destino || 'Casco San José',
        responsable: responsable || 'Equipo San José',
        observaciones: `Retiro de Proveedor hacia Campo. Saldo pendiente en Proveedor: ${nuevoCoop} ${insumo.unidad}. ${observaciones || ''}`.trim(),
      });
      if (errMov) throw errMov;

      notify?.(
        `¡Retiro registrado! Se transfirieron ${cantNum} ${insumo.unidad} de Proveedor al Campo. Saldo pendiente en Proveedor: ${nuevoCoop} ${insumo.unidad}.`,
        'success'
      );
      setRetiroModal(null);
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al registrar retiro de proveedor: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Crear Nuevo Insumo con soporte Dual de Ubicación
  async function handleCreateInsumo(e) {
    if (e) e.preventDefault();
    if (!newInsumoForm.nombre) return;
    setSaving(true);
    try {
      const stCampo = Number(newInsumoForm.stock_campo) || 0;
      const stCoop = Number(newInsumoForm.stock_cooperativa) || 0;
      const cantTotal = Number(newInsumoForm.cantidad_actual) || stCampo + stCoop;

      const { error } = await supabase.from('stock_insumos').insert({
        categoria: newInsumoForm.categoria,
        nombre: newInsumoForm.nombre.trim(),
        unidad: newInsumoForm.unidad,
        cantidad_actual: cantTotal,
        stock_campo:
          stCampo > 0
            ? stCampo
            : (newInsumoForm.ubicacion_tipo?.includes('Proveedor') || newInsumoForm.ubicacion_tipo?.includes('Cooperativa'))
            ? 0
            : cantTotal,
        stock_cooperativa:
          stCoop > 0
            ? stCoop
            : (newInsumoForm.ubicacion_tipo?.includes('Proveedor') || newInsumoForm.ubicacion_tipo?.includes('Cooperativa'))
            ? cantTotal
            : 0,
        ubicacion_tipo: newInsumoForm.ubicacion_tipo || 'En Campo',
        cantidad_minima_alerta: Number(newInsumoForm.cantidad_minima_alerta) || 0,
        ubicacion:
          newInsumoForm.ubicacion?.trim() ||
          (newInsumoForm.ubicacion_tipo?.includes('Proveedor') || newInsumoForm.ubicacion_tipo?.includes('Cooperativa')
            ? 'Proveedor'
            : 'Casco Principal'),
        precio_unitario_ref: Number(newInsumoForm.precio_unitario_ref) || 0,
        moneda: newInsumoForm.moneda || 'ARS',
        fecha_vencimiento: newInsumoForm.fecha_vencimiento || null,
        lote: newInsumoForm.lote?.trim() || null,
        dosis_por_animal: newInsumoForm.dosis_por_animal?.trim() || null,
        observaciones: newInsumoForm.observaciones?.trim() || null,
      });
      if (error) throw error;

      notify?.(`Insumo "${newInsumoForm.nombre}" dado de alta correctamente.`, 'success');
      setShowNewInsumoModal(false);
      setNewInsumoForm({
        categoria: 'Agroquímicos',
        nombre: '',
        unidad: 'Litros',
        cantidad_actual: '',
        stock_campo: '',
        stock_cooperativa: '',
        ubicacion_tipo: 'En Campo',
        cantidad_minima_alerta: '',
        ubicacion: 'Galpón Casco Principal',
        precio_unitario_ref: '',
        moneda: 'ARS',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      notify?.(`Error al crear insumo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado Principal */}
      <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-800">
              <Boxes className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-extrabold text-slate-900">
              Stock de Reservas & Combustible
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              Campaña 2026/2027
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Control de Gasoil, Rollos, Granos, Sales Minerales y Fitosanitarios con alertas de reposición.
          </p>
        </div>

        {/* Botonera Estandarizada: 3 Controles Limpios */}
        <div className="w-full sm:w-auto flex flex-wrap items-center justify-start sm:justify-end gap-2 shrink-0">
          {/* Control 1: Botón Primario de Carga Manual */}
          <button
            type="button"
            onClick={() => {
              setNewInsumoForm({
                categoria: 'Infraestructura / Alambrados',
                nombre: '',
                unidad: 'Unidades',
                cantidad_actual: '',
                stock_campo: '',
                stock_cooperativa: '',
                ubicacion_tipo: 'En Campo',
                cantidad_minima_alerta: '',
                ubicacion: 'Casco Principal',
                precio_unitario_ref: '',
                moneda: 'ARS',
                fecha_vencimiento: '',
                lote: '',
                dosis_por_animal: '',
                observaciones: '',
              });
              setShowNewInsumoModal(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f3e21] text-white font-extrabold text-xs inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-emerald-300" />
            + Nuevo Ítem
          </button>

          {/* Control 2: Botón Único de IA (Escaneo de Medicamento / Remito / Factura con Gemini) */}
          <label className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 hover:from-slate-800 hover:to-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{analyzingVetIa ? 'Escaneando con IA...' : '✨ Importar con IA'}</span>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              disabled={analyzingVetIa}
              onChange={handleScanMedicamentoIA}
              className="hidden"
            />
          </label>

          {/* Control 3: Dropdown Compacto Acciones ▾ */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGalponAcciones((v) => !v)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
            >
              Acciones
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showGalponAcciones ? 'rotate-180' : ''}`} />
            </button>

            {showGalponAcciones && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setShowGalponAcciones(false)}
                />
                <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowGalponAcciones(false);
                      setMovForm((prev) => ({
                        ...prev,
                        insumo_id: insumos[0]?.id || '',
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      }));
                      setShowIngresoModal(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 font-semibold flex items-center gap-2"
                  >
                    <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
                    + Registrar Ingreso / Compra
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowGalponAcciones(false);
                      setLockedInsumo(null);
                      setMovForm((prev) => ({
                        ...prev,
                        insumo_id: insumos[0]?.id || '',
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      }));
                      setShowConsumoModal(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-amber-50 text-slate-700 hover:text-amber-900 font-semibold flex items-center gap-2"
                  >
                    <ArrowUpRight className="w-4 h-4 text-amber-600" />
                    - Registrar Consumo / Egreso
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setShowGalponAcciones(false);
                      setShowGasoilModal(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-amber-50 text-slate-700 hover:text-amber-900 font-semibold flex items-center gap-2"
                  >
                    <Fuel className="w-4 h-4 text-amber-600" />
                    ⛽ Cargar Planilla Gasoil (IA)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pestañas Principales de Insumos & Servicios */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setVistaTab('stock')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 cursor-pointer ${
              vistaTab === 'stock'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4 text-emerald-400" />
            <span>Stock General & Combustible</span>
          </button>

          <button
            type="button"
            onClick={() => setVistaTab('sanidad_catalogo')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 cursor-pointer ${
              vistaTab === 'sanidad_catalogo'
                ? 'bg-purple-900 text-white shadow-sm'
                : 'bg-white hover:bg-purple-50 text-purple-900 border border-purple-200'
            }`}
          >
            <Activity className="w-4 h-4 text-purple-400" />
            <span>💊 Botiquín Veterinario & Catálogo</span>
          </button>

          <button
            type="button"
            onClick={() => setVistaTab('proveedores_esperados')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 cursor-pointer ${
              vistaTab === 'proveedores_esperados'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-white hover:bg-amber-50 text-amber-900 border border-amber-300'
            }`}
          >
            <Truck className="w-4 h-4 text-amber-300" />
            <span>🚚 Proveedores & Servicios Esperados</span>
            {proveedoresEsperados.filter((p) => p.estado !== 'Recibido').length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-200 text-amber-950">
                {proveedoresEsperados.filter((p) => p.estado !== 'Recibido').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* =========================================================================
          SOLAPA 1: INVENTARIO GENERAL DE STOCK
          ========================================================================= */}
      {vistaTab === 'stock' && (
        <div className="space-y-6">
          {/* Tarjetas de KPIs de Stock */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Gasoil en Tanque
            </span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">
              {kpis.gasoilLitros.toLocaleString('es-AR')} <span className="text-sm font-bold text-slate-600">Lts</span>
            </div>
            <div className="text-[11px] text-slate-600 font-medium mt-1">
              Capacidad: 10.000 L (Mínimo: 1.500 L)
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200">
            <Fuel className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Rollos de Pastura
            </span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">
              {kpis.rollosTotal.toLocaleString('es-AR')} <span className="text-sm font-bold text-slate-600">rollos</span>
            </div>
            <div className="text-[11px] text-slate-600 font-medium mt-1">
              Alfalfa y Consociada en tinglado
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Wheat className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Granos / Suplementos
            </span>
            <div className="text-2xl font-black text-slate-900 mt-0.5">
              {(kpis.granosKg / 1000).toFixed(1)} <span className="text-sm font-bold text-slate-600">Tn</span>
            </div>
            <div className="text-[11px] text-slate-600 font-medium mt-1">
              {kpis.granosKg.toLocaleString('es-AR')} kg en silos
            </div>
          </div>
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200">
            <Boxes className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Alertas de Stock
            </span>
            <div className={`text-2xl font-black mt-0.5 ${kpis.itemsBajoMinimo > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
              {kpis.itemsBajoMinimo}{' '}
              <span className="text-sm font-bold text-slate-500">bajo mínimo</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {kpis.itemsBajoMinimo > 0 ? 'Requieren compra urgente' : 'Todos los insumos con stock'}
            </div>
          </div>
          <div className={`p-3 rounded-2xl border ${kpis.itemsBajoMinimo > 0 ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
            {kpis.itemsBajoMinimo > 0 ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
          </div>
        </div>
      </div>

      {/* Filtros de Ubicación, Categoría y Búsqueda */}
      <div className="space-y-2.5">
        {/* Selector Dual de Ubicación del Stock */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 pl-2 pr-1">
              Ubicación:
            </span>
            <button
              type="button"
              onClick={() => setUbicacionFilter('TODAS')}
              className={`px-3 py-1.5 rounded-xl font-bold transition text-xs cursor-pointer ${
                ubicacionFilter === 'TODAS'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-300/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📍 Todo el Stock ({insumos.length})
            </button>
            <button
              type="button"
              onClick={() => setUbicacionFilter('En Campo')}
              className={`px-3 py-1.5 rounded-xl font-bold transition text-xs inline-flex items-center gap-1.5 cursor-pointer ${
                ubicacionFilter === 'En Campo'
                  ? 'bg-emerald-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-emerald-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              🚜 En Campo
            </button>
            <button
              type="button"
              onClick={() => setUbicacionFilter('En Proveedor')}
              className={`px-3 py-1.5 rounded-xl font-bold transition text-xs inline-flex items-center gap-1.5 cursor-pointer ${
                ubicacionFilter === 'En Proveedor' || ubicacionFilter === 'En Cooperativa (Pendiente de retiro)'
                  ? 'bg-amber-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-amber-800'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              🏪 En Proveedor ({kpis.itemsEnProveedor || 0} con saldo)
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setCategoriaFilter('TODOS')}
              className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-xs font-extrabold border transition shrink-0 whitespace-nowrap cursor-pointer ${
                categoriaFilter === 'TODOS'
                  ? 'bg-emerald-900 text-white border-emerald-950 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Todos ({insumos.length})
            </button>
            {CATEGORIAS_INSUMOS.map((cat) => {
              const count = insumos.filter(
                (i) =>
                  i.categoria === cat ||
                  (cat === 'Alambrados / Infraestructura' &&
                    (i.categoria === 'Infraestructura / Alambrados' || i.categoria === 'Alambrados'))
              ).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoriaFilter(cat)}
                  className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-xs font-extrabold border transition shrink-0 whitespace-nowrap cursor-pointer ${
                    categoriaFilter === cat
                      ? 'bg-emerald-900 text-white border-emerald-950 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[220px] shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar insumo o ubicación..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />
          </div>
        </div>
      </div>

      {/* Grilla de Tarjetas de Insumos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredInsumos.map((item) => {
          const actual = Number(item.cantidad_actual || 0);
          const stCampo = Number(item.stock_campo || 0);
          const stCoop = Number(item.stock_cooperativa || 0);
          const min = Number(item.cantidad_minima_alerta || 0);
          const isCritical = actual <= min;
          const pct = min > 0 ? Math.min(100, Math.round((actual / (min * 2)) * 100)) : 100;
          const vencimientoBadge = calcularBadgeVencimiento(item.fecha_vencimiento);

          const ubicacionLimpia = (item.ubicacion || '').trim();
          const etiquetaCampo = ubicacionLimpia ? `🚜 En Campo (${ubicacionLimpia})` : '🚜 En Campo';
          const provLimpio = (item.proveedor || item.origen || '').trim();
          const etiquetaProveedor = provLimpio ? `🏪 En Proveedor (${provLimpio})` : '🏪 En Proveedor';

          return (
            <div
              key={item.id}
              className={`bg-white rounded-2xl p-5 border shadow-sm transition flex flex-col justify-between ${
                isCritical ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200/90'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700">
                    {item.categoria}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isCritical ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-100 text-red-800 border border-red-300 inline-flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
                        Reponer
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        En regla
                      </span>
                    )}

                    {vencimientoBadge && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold inline-flex items-center gap-1 ${vencimientoBadge.color}`}>
                        <Clock className="w-2.5 h-2.5" />
                        {vencimientoBadge.text}
                      </span>
                    )}

                    {/* Acciones directas: Editar y Eliminar sin movimientos compensatorios */}
                    <button
                      type="button"
                      onClick={() => setEditingInsumo(item)}
                      title="Editar insumo o ajustar stock directamente"
                      className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-emerald-800 transition"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteInsumo(item)}
                      title="Eliminar insumo"
                      className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-700 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="font-extrabold text-sm text-slate-900 mt-2">{item.nombre}</h3>

                {/* Stock Dual: En Campo vs. En Proveedor */}
                <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-black text-slate-600 flex items-center gap-1 truncate" title={etiquetaCampo}>
                      {etiquetaCampo}:
                    </span>
                    <span className="text-xs font-black text-slate-900 tabular-nums shrink-0">
                      {stCampo.toLocaleString('es-AR')} {item.unidad}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-black text-amber-800 flex items-center gap-1 truncate" title={etiquetaProveedor}>
                      {etiquetaProveedor}:
                    </span>
                    <span className={`text-xs font-black tabular-nums shrink-0 ${stCoop > 0 ? 'text-amber-800' : 'text-slate-400'}`}>
                      {stCoop.toLocaleString('es-AR')} {item.unidad}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <div>
                    <span className="text-xl font-black text-slate-900">
                      {actual.toLocaleString('es-AR')}
                    </span>
                    <span className="ml-1 text-xs font-bold text-slate-500">{item.unidad} (Total)</span>
                  </div>
                  <div className="text-right text-[11px] text-slate-600 font-medium">
                    Mínimo alerta: <strong className="text-slate-800">{min.toLocaleString('es-AR')} {item.unidad}</strong>
                  </div>
                </div>

                {/* Barra de estado visual */}
                <div className="mt-2 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isCritical ? 'bg-amber-500' : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.max(5, pct)}%` }}
                  />
                </div>
              </div>

              {/* Botones de acción inferior */}
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMovForm((prev) => ({
                        ...prev,
                        insumo_id: item.id,
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      }));
                      setShowIngresoModal(true);
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-extrabold text-[11px] inline-flex items-center justify-center gap-1 transition"
                  >
                    <Plus className="w-3 h-3" />
                    + Carga
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLockedInsumo(item);
                      setMovForm((prev) => ({
                        ...prev,
                        insumo_id: item.id,
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                      }));
                      setShowConsumoModal(true);
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 font-extrabold text-[11px] inline-flex items-center justify-center gap-1 transition shrink-0 whitespace-nowrap"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                    - Consumo
                  </button>
                </div>

                {/* Acción Rápida: Retirar de Proveedor -> Campo */}
                {(stCoop > 0 || item.ubicacion_tipo?.includes('Cooperativa') || item.ubicacion_tipo?.includes('Proveedor')) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRetiroModal({
                        insumo: item,
                        cantidad: item.stock_cooperativa || '',
                        fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
                        destino: item.ubicacion || 'Casco San José',
                        responsable: '',
                      });
                    }}
                    className="w-full py-1.5 px-2 rounded-lg bg-amber-100/90 hover:bg-amber-200 text-amber-950 font-extrabold text-[11px] inline-flex items-center justify-center gap-1.5 transition border border-amber-300 cursor-pointer"
                  >
                    <Truck className="w-3.5 h-3.5 text-amber-800" />
                    Retirar de Proveedor → Campo ({stCoop.toLocaleString('es-AR')} {item.unidad} pend.)
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Historial de Movimientos */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm space-y-3">
        <h3 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-700" />
          Últimos Movimientos de Insumos Registrados ({movimientosInsumos.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                <th className="p-2.5">Fecha</th>
                <th className="p-2.5">Tipo</th>
                <th className="p-2.5">Insumo</th>
                <th className="p-2.5">Cantidad</th>
                <th className="p-2.5">Destino / Detalle</th>
                <th className="p-2.5">Responsable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movimientosInsumos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-400">
                    No hay movimientos de insumos registrados aún.
                  </td>
                </tr>
              ) : (
                movimientosInsumos.slice(0, 15).map((m) => {
                  const ins = insumos.find((i) => i.id === m.insumo_id);
                  const isIngreso = m.tipo?.includes('Ingreso');
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="p-2.5 font-mono text-slate-700">{formatFechaAR(m.fecha)}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                            isIngreso
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {m.tipo}
                        </span>
                      </td>
                      <td className="p-2.5 font-bold text-slate-900">
                        {ins?.nombre || `Insumo #${m.insumo_id}`}
                      </td>
                      <td className="p-2.5 font-extrabold text-slate-800 font-mono">
                        {isIngreso ? '+' : '-'}
                        {Number(m.cantidad).toLocaleString('es-AR')} {ins?.unidad || ''}
                      </td>
                      <td className="p-2.5 text-slate-600">{m.destino || '-'}</td>
                      <td className="p-2.5 text-slate-500">{m.responsable || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )}

      {/* =========================================================================
          SOLAPA 2: BOTIQUÍN VETERINARIO & CATÁLOGO BASE
          ========================================================================= */}
      {vistaTab === 'sanidad_catalogo' && (
        <div className="space-y-6">
          {/* Input oculto para escaneo IA de medicamento */}
          <input
            type="file"
            multiple
            ref={vetIaInputRef}
            onChange={handleScanMedicamentoIA}
            accept="image/*,application/pdf"
            className="hidden"
          />

          {/* Barra superior del Botiquín */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-purple-100 text-purple-900">
                  <Activity className="w-5 h-5 text-purple-800" />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    Botiquín Clínico Veterinario & Catálogo San José
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Control de medicamentos, antibióticos, vacunas, lotes, vencimientos y dosis recomendadas.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleInicializarCatalogoVeterinario}
                title="Carga en 1 clic los medicamentos base que aún no estén en el stock"
                className="px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin text-purple-700" />
                ) : (
                  <Sparkles className="w-4 h-4 text-purple-600" />
                )}
                <span>+ Cargar Catálogo Base</span>
              </button>

              <button
                type="button"
                disabled={analyzingVetIa}
                onClick={() => vetIaInputRef.current?.click()}
                title="Sacá foto o subí la etiqueta del frasco / caja / remito para extraer Lote, Vencimiento y Dosis"
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                {analyzingVetIa ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Camera className="w-4 h-4 text-rose-200" />
                )}
                <span>{analyzingVetIa ? 'Analizando...' : '📷 Escaneo IA Etiqueta/Remito'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNewInsumoForm((prev) => ({
                    ...prev,
                    categoria: 'Sanidad',
                    unidad: 'Frascos',
                    ubicacion: 'Botiquín Veterinario Casco',
                    ubicacion_tipo: 'En Campo',
                  }));
                  setShowNewInsumoModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>+ Nuevo Medicamento</span>
              </button>
            </div>
          </div>

          {/* Tarjetas de Semáforos de Vencimiento */}
          {(() => {
            const sanidadItems = insumos.filter((i) => i.categoria === 'Sanidad');
            const vencidos = sanidadItems.filter((i) => {
              const b = calcularBadgeVencimiento(i.fecha_vencimiento);
              return b?.estado === 'VENCIDO';
            });
            const criticos = sanidadItems.filter((i) => {
              const b = calcularBadgeVencimiento(i.fecha_vencimiento);
              return b?.estado === 'CRITICO';
            });
            const proximos = sanidadItems.filter((i) => {
              const b = calcularBadgeVencimiento(i.fecha_vencimiento);
              return b?.estado === 'ADVERTENCIA';
            });
            const sinStock = sanidadItems.filter((i) => Number(i.cantidad_actual || 0) <= 0);

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`p-3.5 rounded-2xl border ${vencidos.length > 0 ? 'bg-red-50/80 border-red-200 text-red-900' : 'bg-white border-slate-200 text-slate-800'}`}>
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    🔴 Vencidos
                  </span>
                  <div className="text-2xl font-black mt-1">
                    {vencidos.length}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {vencidos.length > 0 ? 'Retirar o descartar frascos' : 'Ningún producto vencido'}
                  </span>
                </div>

                <div className={`p-3.5 rounded-2xl border ${criticos.length > 0 ? 'bg-amber-50/80 border-amber-300 text-amber-950' : 'bg-white border-slate-200 text-slate-800'}`}>
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    ⚠️ Críticos (≤30 días)
                  </span>
                  <div className="text-2xl font-black mt-1">
                    {criticos.length}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Priorizar en próximas mangas
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl border bg-white border-slate-200 text-slate-800">
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    🟡 Advertencia (≤60 días)
                  </span>
                  <div className="text-2xl font-black mt-1 text-amber-800">
                    {proximos.length}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Vencimiento en 2 meses
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl border bg-white border-slate-200 text-slate-800">
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    📦 Sin Stock en Campo
                  </span>
                  <div className="text-2xl font-black mt-1 text-slate-900">
                    {sinStock.length}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Total en botiquín: {sanidadItems.length}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Tabla de Medicamentos e Insumos Sanitarios */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                Inventario Clínico y Botiquín ({insumos.filter((i) => i.categoria === 'Sanidad').length} ítems)
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Dosis por animal · Lotes · Fechas de vencimiento
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10.5px] font-black uppercase text-slate-600 border-b border-slate-100">
                  <tr>
                    <th className="p-3">Medicamento / Vacuna</th>
                    <th className="p-3">Lote & Vencimiento</th>
                    <th className="p-3">Dosis Recomendada</th>
                    <th className="p-3">Stock Campo</th>
                    <th className="p-3">En Proveedor</th>
                    <th className="p-3">Ubicación</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {insumos.filter((i) => i.categoria === 'Sanidad').length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-bold text-slate-600">No hay medicamentos cargados en Sanidad aún.</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Hacé clic en <strong>"+ Cargar Catálogo Base"</strong> para inicializar en 1 clic el botiquín estándar de San José.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    insumos
                      .filter((i) => i.categoria === 'Sanidad')
                      .map((item) => {
                        const badgeVenc = calcularBadgeVencimiento(item.fecha_vencimiento);
                        const stCampo = Number(item.stock_campo || item.cantidad_actual || 0);
                        const stCoop = Number(item.stock_cooperativa || 0);
                        const isBajo = stCampo <= Number(item.cantidad_minima_alerta || 0);

                        return (
                          <tr key={item.id} className="hover:bg-slate-50/80 transition">
                            <td className="p-3">
                              <div className="font-black text-slate-900 text-xs sm:text-sm">
                                {item.nombre}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {item.tipo_gestion && (
                                  <span className="px-1.5 py-0.2 rounded text-[9.5px] font-extrabold bg-purple-50 text-purple-900 border border-purple-200">
                                    {item.tipo_gestion}
                                  </span>
                                )}
                                {item.observaciones && (
                                  <span className="text-[10.5px] text-slate-500 truncate max-w-xs" title={item.observaciones}>
                                    {item.observaciones}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="p-3">
                              {item.lote && (
                                <div className="text-[10px] font-mono text-slate-600 font-bold">
                                  LOTE: {item.lote}
                                </div>
                              )}
                              {badgeVenc ? (
                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${badgeVenc.color} mt-0.5`}>
                                  {badgeVenc.text}
                                </span>
                              ) : (
                                <span className="text-[10.5px] text-slate-400 italic">Sin vencimiento</span>
                              )}
                            </td>

                            <td className="p-3">
                              {item.dosis_por_animal ? (
                                <span className="font-extrabold text-purple-950 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/80 text-[11px] font-mono">
                                  {item.dosis_por_animal}
                                </span>
                              ) : (
                                <span className="text-slate-400 text-[11px]">-</span>
                              )}
                            </td>

                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span className={`font-mono text-sm font-black ${isBajo ? 'text-amber-700' : 'text-slate-900'}`}>
                                  {stCampo.toLocaleString('es-AR')} {item.unidad}
                                </span>
                                {isBajo && (
                                  <span className="px-1.5 py-0.2 rounded text-[9.5px] font-extrabold bg-amber-100 text-amber-900">
                                    Bajo
                                  </span>
                                )}
                              </div>
                              {Number(item.cantidad_minima_alerta || 0) > 0 && (
                                <span className="text-[10px] text-slate-400 block">
                                  Mín: {Number(item.cantidad_minima_alerta)} {item.unidad}
                                </span>
                              )}
                            </td>

                            <td className="p-3">
                              {stCoop > 0 ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
                                  <Store className="w-3 h-3 text-amber-700" />
                                  {stCoop.toLocaleString('es-AR')} {item.unidad}
                                </span>
                              ) : (
                                <span className="text-slate-300 text-[11px]">-</span>
                              )}
                            </td>

                            <td className="p-3 text-slate-600 font-medium">
                              {item.ubicacion || 'Botiquín Casco'}
                            </td>

                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMovForm({
                                      ...movForm,
                                      insumo_id: String(item.id),
                                      destino: 'Botiquín Veterinario Casco',
                                    });
                                    setShowIngresoModal(true);
                                  }}
                                  title="Ingreso / Compra de stock"
                                  className="p-1.5 rounded-lg bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-bold cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMovForm({
                                      ...movForm,
                                      insumo_id: String(item.id),
                                      destino: 'Aplicación / Sanidad en Manga',
                                    });
                                    setShowConsumoModal(true);
                                  }}
                                  title="Registrar aplicación o consumo"
                                  className="p-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 font-bold cursor-pointer"
                                >
                                  <ArrowUpRight className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingInsumo(item)}
                                  title="Editar medicamento / lote / stock"
                                  className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteInsumo(item)}
                                  title="Eliminar del botiquín"
                                  className="p-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-bold cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SOLAPA 3: PROVEEDORES & SERVICIOS ESPERADOS
          ========================================================================= */}
      {vistaTab === 'proveedores_esperados' && (
        <div className="space-y-6">
          {/* Barra superior de Proveedores */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-amber-100 text-amber-900">
                  <Truck className="w-5 h-5 text-amber-800" />
                </span>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                    🚚 Llegadas de Proveedores, Camionadas y Servicios
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Seguimiento logístico de entregas de tosca/piedra, postes, varillas, alambrados, semillas, ración y servicios agendados.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingProveedor(null);
                  const r = calcularRangoSemanal(new Date(), 0, 1);
                  setProveedorForm({
                    proveedor_o_rubro: 'Piedra / Tosca',
                    indicaciones: '',
                    modalidad_fecha: 'semana',
                    semana_estimada: r.fechaInicio,
                    semana_fin: r.fechaFin,
                    cantidad_semanas: 1,
                    estado: 'Esperando',
                    notas: '',
                  });
                  setShowNewProveedorModal(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>+ Agendar Proveedor / Servicio</span>
              </button>
            </div>
          </div>

          {/* KPIs de Proveedores Esperados */}
          {(() => {
            const total = proveedoresEsperados.length;
            const esperando = proveedoresEsperados.filter((p) => p.estado === 'Esperando').length;
            const enCamino = proveedoresEsperados.filter((p) => p.estado === 'En Camino').length;
            const recibidos = proveedoresEsperados.filter((p) => p.estado === 'Recibido').length;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-2xl border bg-white border-slate-200 text-slate-800">
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    📋 Total Agendados
                  </span>
                  <div className="text-2xl font-black mt-1 text-slate-900">
                    {total}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Entregas y servicios en San José
                  </span>
                </div>

                <div className={`p-3.5 rounded-2xl border ${esperando > 0 ? 'bg-amber-50/70 border-amber-300 text-amber-950' : 'bg-white border-slate-200 text-slate-800'}`}>
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    ⏳ Pendientes / Esperando
                  </span>
                  <div className="text-2xl font-black mt-1 text-amber-800">
                    {esperando}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Llegadas programadas
                  </span>
                </div>

                <div className={`p-3.5 rounded-2xl border ${enCamino > 0 ? 'bg-blue-50/70 border-blue-300 text-blue-950' : 'bg-white border-slate-200 text-slate-800'}`}>
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    🚚 En Camino / En Viaje
                  </span>
                  <div className="text-2xl font-black mt-1 text-blue-800">
                    {enCamino}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Camión o servicio en tránsito
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl border bg-white border-slate-200 text-slate-800">
                  <span className="text-[10px] font-black uppercase tracking-wider block text-slate-500">
                    ✅ Recibidos en Campo
                  </span>
                  <div className="text-2xl font-black mt-1 text-emerald-800">
                    {recibidos}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Descargas confirmadas
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Tabla de Proveedores Esperados */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                Logística de Entregas y Llegadas
              </span>
              {loadingProveedores && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Actualizando...
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-[10.5px] font-black uppercase text-slate-600 border-b border-slate-100">
                  <tr>
                    <th className="p-3">Proveedor / Rubro</th>
                    <th className="p-3">Semana / Fecha Estimada</th>
                    <th className="p-3">Indicaciones de Descarga / Chofer</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Notas / Contacto</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {proveedoresEsperados.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        <Truck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="font-bold text-slate-600">No hay proveedores ni servicios agendados.</p>
                        <p className="text-xs text-slate-400 mt-1">
                          Hacé clic en <strong>"+ Agendar Proveedor / Servicio"</strong> para coordinar descargas de tosca, postes, sanidad o ración.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    proveedoresEsperados.map((prov) => {
                      const isRecibido = prov.estado === 'Recibido';
                      const isEnCamino = prov.estado === 'En Camino';
                      const isEsperando = prov.estado === 'Esperando' || !prov.estado;

                      return (
                        <tr key={prov.id} className="hover:bg-slate-50/80 transition">
                          <td className="p-3">
                            <div className="font-black text-slate-900 text-xs sm:text-sm flex items-center gap-2">
                              <Truck className="w-4 h-4 text-amber-700 shrink-0" />
                              <span>{prov.proveedor_o_rubro}</span>
                            </div>
                          </td>

                          <td className="p-3 font-mono font-bold text-slate-700">
                            {prov.semana_estimada ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-950 text-xs font-semibold">
                                <Calendar className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                <span>{formatRangoProveedorAR(prov.semana_estimada, prov.semana_fin)}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          <td className="p-3 text-slate-700 max-w-xs">
                            {prov.indicaciones ? (
                              <span className="font-medium text-slate-800">{prov.indicaciones}</span>
                            ) : (
                              <span className="text-slate-400 italic">Sin indicaciones especiales</span>
                            )}
                          </td>

                          <td className="p-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-black border ${
                                isRecibido
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                  : isEnCamino
                                  ? 'bg-blue-100 text-blue-900 border-blue-300'
                                  : isEsperando
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                            >
                              {isRecibido && <CheckCircle2 className="w-3 h-3 text-emerald-700" />}
                              {isEnCamino && <Truck className="w-3 h-3 text-blue-700" />}
                              {isEsperando && <Clock className="w-3 h-3 text-amber-700" />}
                              {prov.estado || 'Esperando'}
                            </span>
                          </td>

                          <td className="p-3 text-slate-600 text-[11px] max-w-xs truncate" title={prov.notas || ''}>
                            {prov.notas || '-'}
                          </td>

                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {!isRecibido && (
                                <button
                                  type="button"
                                  onClick={() => handleMarcarProveedorRecibido(prov)}
                                  title="Marcar como Recibido en Campo"
                                  className="px-2.5 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 font-bold text-[10.5px] inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Recibir</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProveedor(prov);
                                  const isRange = Boolean(prov.semana_fin && prov.semana_fin !== prov.semana_estimada);
                                  setProveedorForm({
                                    proveedor_o_rubro: prov.proveedor_o_rubro || '',
                                    indicaciones: prov.indicaciones || '',
                                    modalidad_fecha: isRange ? 'semana' : 'dia',
                                    semana_estimada: prov.semana_estimada || '',
                                    semana_fin: prov.semana_fin || '',
                                    cantidad_semanas: 1,
                                    estado: prov.estado || 'Esperando',
                                    notas: prov.notas || '',
                                  });
                                  setShowNewProveedorModal(true);
                                }}
                                title="Editar llegada"
                                className="p-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold cursor-pointer"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProveedor(prov.id)}
                                title="Eliminar registro"
                                className="p-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-bold cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Ingreso */}
      {showIngresoModal && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-emerald-600" />
                Registrar Ingreso / Compra de Insumo
              </h3>
              <button
                type="button"
                onClick={() => setShowIngresoModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIngreso} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Insumo *
                </label>
                <select
                  value={movForm.insumo_id}
                  onChange={(e) => setMovForm({ ...movForm, insumo_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  required
                >
                  {insumos.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre} (Stock actual: {i.cantidad_actual} {i.unidad})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Cantidad a Ingresar *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Ej: 1500"
                    value={movForm.cantidad}
                    onChange={(e) => setMovForm({ ...movForm, cantidad: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={movForm.fecha}
                    onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Proveedor / Origen
                </label>
                <input
                  type="text"
                  placeholder="Ej: YPF Directo, ACA, Confección propia"
                  value={movForm.destino}
                  onChange={(e) => setMovForm({ ...movForm, destino: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Responsable
                </label>
                <input
                  type="text"
                  placeholder="Nombre de quien recibió"
                  value={movForm.responsable}
                  onChange={(e) => setMovForm({ ...movForm, responsable: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowIngresoModal(false)}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold"
                >
                  {saving ? 'Guardando...' : 'Guardar Ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar Consumo */}
      {showConsumoModal && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-amber-600" />
                Registrar Consumo / Egreso de Insumo
              </h3>
              <button
                type="button"
                onClick={() => setShowConsumoModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConsumo} className="space-y-3">
              {lockedInsumo ? (
                <div className="p-3 bg-amber-50/90 border border-amber-300 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                      Insumo Seleccionado
                    </span>
                    <span className="text-sm font-black text-slate-900 block mt-0.5">
                      {lockedInsumo.nombre}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-500 block">Stock Disponible</span>
                    <span className="text-xs font-black text-amber-900 tabular-nums">
                      {Number(lockedInsumo.cantidad_actual || 0).toLocaleString('es-AR')} {lockedInsumo.unidad}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Insumo *
                  </label>
                  <select
                    value={movForm.insumo_id}
                    onChange={(e) => setMovForm({ ...movForm, insumo_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                    required
                  >
                    {insumos.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nombre} (Disponible: {Number(i.cantidad_actual || 0).toLocaleString('es-AR')} {i.unidad})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Cantidad Descontada *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Ej: 120"
                    value={movForm.cantidad}
                    onChange={(e) => setMovForm({ ...movForm, cantidad: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    value={movForm.fecha}
                    onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Destino / Máquina / Rodeo
                </label>
                <input
                  type="text"
                  placeholder="Ej: Tractor John Deere 6110J, Rodeo Cabeza P5"
                  value={movForm.destino}
                  onChange={(e) => setMovForm({ ...movForm, destino: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Responsable
                </label>
                <input
                  type="text"
                  placeholder="Tractorista / Encargado"
                  value={movForm.responsable}
                  onChange={(e) => setMovForm({ ...movForm, responsable: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConsumoModal(false)}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold"
                >
                  {saving ? 'Guardando...' : 'Descontar Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nuevo Ítem de Insumo */}
      {showNewInsumoModal && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Boxes className="w-5 h-5 text-emerald-700" />
                Alta de Nuevo Insumo / Reserva
              </h3>
              <button
                type="button"
                onClick={() => setShowNewInsumoModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateInsumo} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={newInsumoForm.categoria}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {CATEGORIAS_INSUMOS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Unidad de Medida *
                  </label>
                  <select
                    value={newInsumoForm.unidad}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, unidad: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {UNIDADES_INSUMOS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Nombre del Insumo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Nafta Súper, Sales con Cobre, Glifosato II"
                  value={newInsumoForm.nombre}
                  onChange={(e) => setNewInsumoForm({ ...newInsumoForm, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                />
              </div>

              {/* Stock Dual: En Campo vs. En Proveedor */}
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-900 block">
                  📍 Stock Inicial por Ubicación
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      🚜 Stock en Campo
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={newInsumoForm.stock_campo}
                      onChange={(e) => setNewInsumoForm({ ...newInsumoForm, stock_campo: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-black"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      🏪 En Proveedor (Pendiente)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={newInsumoForm.stock_cooperativa}
                      onChange={(e) => setNewInsumoForm({ ...newInsumoForm, stock_cooperativa: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs font-black"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 italic">
                  * Stock total inicial: {(Number(newInsumoForm.stock_campo || 0) + Number(newInsumoForm.stock_cooperativa || 0)).toLocaleString('es-AR')} {newInsumoForm.unidad}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Ubicación Específica en Campo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Tanque Aéreo Casco, Tinglado Casco, Galpón Casco Principal"
                    value={newInsumoForm.ubicacion}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, ubicacion: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Mínimo Alerta Reponer
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0"
                    value={newInsumoForm.cantidad_minima_alerta}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, cantidad_minima_alerta: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Precio Ref. Unitario USD
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newInsumoForm.precio_unitario_ref}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, precio_unitario_ref: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Ubicación Principal
                  </label>
                  <select
                    value={newInsumoForm.ubicacion_tipo}
                    onChange={(e) => setNewInsumoForm({ ...newInsumoForm, ubicacion_tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-bold"
                  >
                    <option value="En Campo">🚜 En Campo</option>
                    <option value="En Proveedor (Pendiente de retiro)">🏪 En Proveedor (Pendiente de retiro)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Observaciones
                </label>
                <textarea
                  rows={2}
                  value={newInsumoForm.observaciones}
                  onChange={(e) => setNewInsumoForm({ ...newInsumoForm, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  placeholder="Anotaciones técnicas, proveedor, etc."
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewInsumoModal(false)}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : 'Crear Insumo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Insumo Directo (Sin obligar a compensatorio) */}
      {editingInsumo && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Edit className="w-5 h-5 text-emerald-800" />
                Editar Insumo / Ajuste Directo de Stock
              </h3>
              <button
                type="button"
                onClick={() => setEditingInsumo(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditInsumo} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Nombre del Insumo *
                </label>
                <input
                  type="text"
                  required
                  value={editingInsumo.nombre || ''}
                  onChange={(e) => setEditingInsumo({ ...editingInsumo, nombre: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={editingInsumo.categoria || ''}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, categoria: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {CATEGORIAS_INSUMOS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Unidad de Medida *
                  </label>
                  <select
                    value={editingInsumo.unidad || ''}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, unidad: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                  >
                    {UNIDADES_INSUMOS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    {editingInsumo.unidad && !UNIDADES_INSUMOS.includes(editingInsumo.unidad) && (
                      <option value={editingInsumo.unidad}>{editingInsumo.unidad}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Ajuste directo de Stock Físico vs. Proveedor */}
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200/80 space-y-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-emerald-900 block">
                  📍 Stock por Ubicación (Editable sin compensatorio)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      🚜 Stock en Campo
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingInsumo.stock_campo ?? ''}
                      onChange={(e) => setEditingInsumo({ ...editingInsumo, stock_campo: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-black"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      🏪 En Proveedor (Pendiente)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingInsumo.stock_cooperativa ?? ''}
                      onChange={(e) => setEditingInsumo({ ...editingInsumo, stock_cooperativa: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs font-black"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 italic">
                  * El stock total será la suma de Campo + Proveedor: {(Number(editingInsumo.stock_campo || 0) + Number(editingInsumo.stock_cooperativa || 0)).toLocaleString('es-AR')} {editingInsumo.unidad || ''}.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Ubicación Específica en Campo
                  </label>
                  <input
                    type="text"
                    value={editingInsumo.ubicacion || ''}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, ubicacion: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    placeholder="Ej: Tanque Aéreo Casco, Tinglado Casco, Galpón Casco Principal"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Mínimo Alerta Reponer
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingInsumo.cantidad_minima_alerta ?? ''}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, cantidad_minima_alerta: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Precio Ref. Unitario USD
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingInsumo.precio_unitario_ref ?? ''}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, precio_unitario_ref: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    placeholder="USD"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Ubicación Principal
                  </label>
                  <select
                    value={editingInsumo.ubicacion_tipo || 'En Campo'}
                    onChange={(e) => setEditingInsumo({ ...editingInsumo, ubicacion_tipo: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-bold"
                  >
                    <option value="En Campo">🚜 En Campo</option>
                    <option value="En Proveedor (Pendiente de retiro)">🏪 En Proveedor (Pendiente de retiro)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Observaciones / Lote / Vencimiento
                </label>
                <textarea
                  rows={2}
                  value={editingInsumo.observaciones || ''}
                  onChange={(e) => setEditingInsumo({ ...editingInsumo, observaciones: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  placeholder="Anotaciones técnicas, remito o vencimiento"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => handleDeleteInsumo(editingInsumo)}
                  className="py-2 px-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold inline-flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar Insumo
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingInsumo(null)}
                    className="py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="py-2 px-4 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-extrabold shadow-sm transition"
                  >
                    {saving ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Retirar de Proveedor -> Campo */}
      {retiroModal && retiroModal.insumo && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-amber-700" />
                Retirar de Proveedor → Campo
              </h3>
              <button
                type="button"
                onClick={() => setRetiroModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
                Insumo a Trasladar
              </span>
              <span className="text-sm font-black text-slate-900 block">
                {retiroModal.insumo.nombre}
              </span>
              <div className="flex items-center justify-between text-xs pt-1 text-slate-600">
                <span>
                  Saldo en Proveedor{retiroModal.insumo.proveedor ? ` (${retiroModal.insumo.proveedor})` : ''}: <strong>{Number(retiroModal.insumo.stock_cooperativa || 0).toLocaleString('es-AR')} {retiroModal.insumo.unidad}</strong>
                </span>
                <span>
                  En Campo actual: <strong>{Number(retiroModal.insumo.stock_campo || 0).toLocaleString('es-AR')} {retiroModal.insumo.unidad}</strong>
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmRetiro} className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold uppercase text-slate-600">
                    Cantidad a Retirar ({retiroModal.insumo.unidad}) *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setRetiroModal({
                        ...retiroModal,
                        cantidad: retiroModal.insumo.stock_cooperativa || 0,
                      })
                    }
                    className="text-[10px] font-black text-amber-800 hover:underline"
                  >
                    Retirar Todo ({Number(retiroModal.insumo.stock_cooperativa || 0)} {retiroModal.insumo.unidad})
                  </button>
                </div>
                <input
                  type="number"
                  step="0.01"
                  required
                  max={
                    Number(retiroModal.insumo.stock_cooperativa || 0) > 0
                      ? Number(retiroModal.insumo.stock_cooperativa)
                      : undefined
                  }
                  value={retiroModal.cantidad}
                  onChange={(e) => setRetiroModal({ ...retiroModal, cantidad: e.target.value })}
                  placeholder="Ej: 500"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-black text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Fecha de Retiro
                  </label>
                  <input
                    type="date"
                    required
                    value={retiroModal.fecha}
                    onChange={(e) => setRetiroModal({ ...retiroModal, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Destino en Campo
                  </label>
                  <input
                    type="text"
                    value={retiroModal.destino}
                    onChange={(e) => setRetiroModal({ ...retiroModal, destino: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    placeholder={retiroModal.insumo.ubicacion || 'Casco San José'}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Responsable / Chofer / Camión
                </label>
                <input
                  type="text"
                  value={retiroModal.responsable}
                  onChange={(e) => setRetiroModal({ ...retiroModal, responsable: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  placeholder="Ej: Juan Pérez / Camión propio"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRetiroModal(null)}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Trasladando...' : 'Confirmar Retiro a Campo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Escáner IA de Planilla de Gasoil */}
      {showGasoilModal && (
        <GeminiPlanillaGasoilModal
          isOpen={true}
          onClose={() => setShowGasoilModal(false)}
          maquinaria={maquinaria}
          insumos={insumos}
          fechaOperacion={fechaOperacion}
          dolarRef={dolarRef}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {/* Modal Agendar / Editar Proveedor Esperado */}
      {(showNewProveedorModal || editingProveedor) && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Truck className="w-5 h-5 text-amber-700" />
                {editingProveedor ? 'Editar Proveedor / Servicio Agendado' : 'Agendar Proveedor o Servicio Esperado'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewProveedorModal(false);
                  setEditingProveedor(null);
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProveedorEsperado} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Proveedor o Rubro *
                </label>
                <input
                  type="text"
                  required
                  list="rubros-sugeridos"
                  value={proveedorForm.proveedor_o_rubro}
                  onChange={(e) => setProveedorForm({ ...proveedorForm, proveedor_o_rubro: e.target.value })}
                  placeholder="Ej: Piedra / Tosca, Postes, Alambre, Sanidad, Ración..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                />
                <datalist id="rubros-sugeridos">
                  <option value="Piedra / Tosca para Callejón" />
                  <option value="Postes y Varillas (Alambrado)" />
                  <option value="Rollos de Alambre y Aisladores" />
                  <option value="Gasoil / Combustible YPF" />
                  <option value="Medicamentos / Sanidad Veterinaria" />
                  <option value="Semillas / Fertilizantes" />
                  <option value="Ración / Suplementación" />
                  <option value="Servicio de Molinero / Aguadas" />
                  <option value="Servicio de Tractorista / Picado" />
                </datalist>
              </div>

              {/* Modalidad de Fecha: Por Semana o Rango / Día puntual */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase text-slate-600">
                  Planificación Temporal *
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      const rango = calcularRangoSemanal(proveedorForm.semana_estimada || new Date(), 0, proveedorForm.cantidad_semanas || 1);
                      setProveedorForm({
                        ...proveedorForm,
                        modalidad_fecha: 'semana',
                        semana_estimada: rango.fechaInicio,
                        semana_fin: rango.fechaFin,
                      });
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      proveedorForm.modalidad_fecha === 'semana'
                        ? 'bg-amber-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Por Semana / Rango</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProveedorForm({
                        ...proveedorForm,
                        modalidad_fecha: 'dia',
                        semana_fin: null,
                      });
                    }}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      proveedorForm.modalidad_fecha === 'dia'
                        ? 'bg-amber-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Día Puntual</span>
                  </button>
                </div>
              </div>

              {proveedorForm.modalidad_fecha === 'semana' ? (
                <div className="space-y-2.5 p-3 rounded-xl bg-amber-50/80 border border-amber-200">
                  {/* Botones de selección rápida de semana */}
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block mb-1.5">
                      Selección Rápida de Semanas:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const r = calcularRangoSemanal(new Date(), 0, 1);
                          setProveedorForm({ ...proveedorForm, semana_estimada: r.fechaInicio, semana_fin: r.fechaFin, cantidad_semanas: 1 });
                        }}
                        className={`py-1 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                          proveedorForm.cantidad_semanas === 1 && proveedorForm.semana_estimada === calcularRangoSemanal(new Date(), 0, 1).fechaInicio
                            ? 'bg-amber-700 text-white border-amber-800'
                            : 'bg-white text-amber-950 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        📍 Esta semana
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const r = calcularRangoSemanal(new Date(), 1, 1);
                          setProveedorForm({ ...proveedorForm, semana_estimada: r.fechaInicio, semana_fin: r.fechaFin, cantidad_semanas: 1 });
                        }}
                        className={`py-1 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                          proveedorForm.cantidad_semanas === 1 && proveedorForm.semana_estimada === calcularRangoSemanal(new Date(), 1, 1).fechaInicio
                            ? 'bg-amber-700 text-white border-amber-800'
                            : 'bg-white text-amber-950 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        ⏭️ Próxima sem.
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = proveedorForm.semana_estimada || new Date();
                          const r = calcularRangoSemanal(base, 0, 2);
                          setProveedorForm({ ...proveedorForm, semana_estimada: r.fechaInicio, semana_fin: r.fechaFin, cantidad_semanas: 2 });
                        }}
                        className={`py-1 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                          proveedorForm.cantidad_semanas === 2
                            ? 'bg-amber-700 text-white border-amber-800'
                            : 'bg-white text-amber-950 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        2 semanas
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = proveedorForm.semana_estimada || new Date();
                          const r = calcularRangoSemanal(base, 0, 3);
                          setProveedorForm({ ...proveedorForm, semana_estimada: r.fechaInicio, semana_fin: r.fechaFin, cantidad_semanas: 3 });
                        }}
                        className={`py-1 px-2 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                          proveedorForm.cantidad_semanas === 3
                            ? 'bg-amber-700 text-white border-amber-800'
                            : 'bg-white text-amber-950 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        3 semanas
                      </button>
                    </div>
                  </div>

                  {/* Fechas Desde / Hasta */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10.5px] font-bold uppercase text-amber-900 mb-1">
                        Desde (Lunes) *
                      </label>
                      <input
                        type="date"
                        required
                        value={proveedorForm.semana_estimada}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          const r = calcularRangoSemanal(newStart, 0, proveedorForm.cantidad_semanas || 1);
                          setProveedorForm({
                            ...proveedorForm,
                            semana_estimada: newStart,
                            semana_fin: r.fechaFin,
                          });
                        }}
                        className="w-full px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-bold text-amber-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-bold uppercase text-amber-900 mb-1">
                        Hasta (Domingo) *
                      </label>
                      <input
                        type="date"
                        required
                        value={proveedorForm.semana_fin || ''}
                        onChange={(e) => setProveedorForm({ ...proveedorForm, semana_fin: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-bold text-amber-950"
                      />
                    </div>
                  </div>

                  {/* Badge resumen de semana */}
                  <div className="flex items-center justify-between text-xs font-black text-amber-950 pt-1">
                    <span>Rango programado:</span>
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-200/80 border border-amber-300 font-mono">
                      {formatRangoProveedorAR(proveedorForm.semana_estimada, proveedorForm.semana_fin)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Fecha Exacta Prevista *
                  </label>
                  <input
                    type="date"
                    required
                    value={proveedorForm.semana_estimada}
                    onChange={(e) => setProveedorForm({ ...proveedorForm, semana_estimada: e.target.value, semana_fin: null })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Estado Actual *
                </label>
                <select
                  value={proveedorForm.estado}
                  onChange={(e) => setProveedorForm({ ...proveedorForm, estado: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold bg-white"
                >
                  <option value="Esperando">⏳ Esperando</option>
                  <option value="En Camino">🚚 En Camino</option>
                  <option value="Recibido">✅ Recibido en Campo</option>
                  <option value="Cancelado">❌ Cancelado / Postergado</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Indicaciones de Descarga / Chofer
                </label>
                <textarea
                  rows={2}
                  value={proveedorForm.indicaciones || ''}
                  onChange={(e) => setProveedorForm({ ...proveedorForm, indicaciones: e.target.value })}
                  placeholder="Ej: Camión con batea descargar en callejón de entrada. Avisar 30 min antes."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Notas / Contacto Fletero / Remito
                </label>
                <textarea
                  rows={2}
                  value={proveedorForm.notas || ''}
                  onChange={(e) => setProveedorForm({ ...proveedorForm, notas: e.target.value })}
                  placeholder="Teléfono del chofer, número de remito o condiciones de pago"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewProveedorModal(false);
                    setEditingProveedor(null);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-extrabold shadow-sm transition"
                >
                  {saving ? 'Guardando...' : editingProveedor ? 'Actualizar Registro' : 'Agendar Llegada'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
