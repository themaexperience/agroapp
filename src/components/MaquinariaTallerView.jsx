import React, { useState, useMemo, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import {
  Wrench,
  Search,
  Plus,
  Save,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  DollarSign,
  Filter,
  ChevronRight,
  Settings,
  Calendar,
  X,
  Edit3,
  ClipboardCheck,
  FileDown,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR } from '../utils/dateHelper';
import { confirmAction } from './ConfirmDialog';
import {
  getSanJoseLogoDataUrl,
  drawSanJosePdfHeader,
  drawSanJoseSignatureFooter,
} from '../utils/pdfHelper';
import GeminiRepuestoModal from './GeminiRepuestoModal.jsx';

export const CATEGORIAS_MAQUINARIA = [
  'Tractores y Autopropulsados',
  'Implementos y Maquinaria Agrícola',
  'Herramientas y Equipos Menores',
];

export const ESTADOS_MAQUINARIA = ['Operativa', 'En Service', 'Fuera de servicio'];

const MESES_CONTROL = [
  { key: 'ENE', label: 'ENE' },
  { key: 'FEB', label: 'FEB' },
  { key: 'MAR', label: 'MAR' },
  { key: 'ABR', label: 'ABR' },
  { key: 'MAY', label: 'MAY' },
  { key: 'JUN', label: 'JUN' },
  { key: 'JUL', label: 'JUL' },
  { key: 'AGO', label: 'AGO' },
  { key: 'SET', label: 'SET' },
  { key: 'OCT', label: 'OCT' },
  { key: 'NOV', label: 'NOV' },
  { key: 'DIC', label: 'DIC' },
];

function getEstadoBadgeStyle(estado) {
  if (estado === 'Operativa') {
    return 'bg-emerald-100 text-emerald-900 border-emerald-300';
  }
  if (estado === 'En Service') {
    return 'bg-amber-100 text-amber-900 border-amber-300';
  }
  return 'bg-red-100 text-red-900 border-red-300';
}

function getCategoriaBadgeStyle(cat) {
  if (cat === 'Tractores y Autopropulsados') {
    return 'bg-emerald-50 text-emerald-900 border-emerald-200';
  }
  if (cat === 'Implementos y Maquinaria Agrícola') {
    return 'bg-amber-50 text-amber-900 border-amber-200';
  }
  return 'bg-sky-50 text-sky-900 border-sky-200';
}

export default function MaquinariaTallerView({
  maquinaria = [],
  maquinariaRepuestos = [],
  maquinariaServices = [],
  fechaOperacion,
  dolarRef = 1540,
  onRefresh,
  notify,
}) {
  const [subTab, setSubTab] = useState('inventario'); // 'inventario' | 'services' | 'protocolo'
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterEstado, setFilterEstado] = useState('TODOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [showGeminiRepuestoModal, setShowGeminiRepuestoModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edición rápida de Horas/Km en la tabla principal con auto-guardado
  const [inlineHoras, setInlineHoras] = useState({});
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const autoSaveTimerRef = useRef(null);
  const debounceHorasTimersRef = useRef({}); // { [maqId]: timerId }

  // Modal de Ficha Técnica Completa (Ficha 1 Repuestos + Ficha 2 Control Mensual)
  const [selectedMaqId, setSelectedMaqId] = useState(null);
  const [fichaTab, setFichaTab] = useState('repuestos'); // 'repuestos' | 'mensual' | 'historial'
  const [editedMaqHeader, setEditedMaqHeader] = useState(null);
  const [editedRepuestos, setEditedRepuestos] = useState({});
  const [newRepuesto, setNewRepuesto] = useState({
    componente: '',
    marca_modelo_compatible: '',
    numero_parte: '',
    proveedor: '',
    notas: '',
  });

  // Modal de Nuevo Service / Mantenimiento
  const [serviceModalMaq, setServiceModalMaq] = useState(null);
  const [serviceForm, setServiceForm] = useState({
    maquinaria_id: '',
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    tipo_service: 'Mantenimiento / Cambio de Repuesto',
    horas_km: '',
    repuesto_colocado: '',
    numero_parte_usado: '',
    proveedor_taller: '',
    moneda_carga: 'ARS',
    costo_input: '',
    impactar_gastos: true,
    observaciones: '',
    tareas_items: [{ detalle: 'Cambio de Aceite y Filtros', repuesto: '', numero_parte: '', costo: '' }],
    proximo_service_horas_km: '',
    proximo_service_fecha: '',
  });

  // Modal de Nueva Máquina
  const [showNewMaqModal, setShowNewMaqModal] = useState(false);
  const [newMaqForm, setNewMaqForm] = useState({
    codigo_ficha: '',
    categoria: 'Tractores y Autopropulsados',
    nombre: '',
    otro_nombre: '',
    estado: 'Operativa',
    horas_km_actuales: '',
    responsable: '',
    notas: '',
  });

  useEffect(() => {
    if (fechaOperacion) {
      setServiceForm((prev) => ({ ...prev, fecha: fechaOperacion }));
    }
  }, [fechaOperacion]);

  // Agrupar repuestos por maquinaria_id
  const repuestosPorMaq = useMemo(() => {
    const map = new Map();
    maquinariaRepuestos.forEach((rep) => {
      const list = map.get(rep.maquinaria_id) || [];
      list.push(rep);
      map.set(rep.maquinaria_id, list);
    });
    return map;
  }, [maquinariaRepuestos]);

  // Agrupar services por maquinaria_id
  const servicesPorMaq = useMemo(() => {
    const map = new Map();
    maquinariaServices.forEach((srv) => {
      const list = map.get(srv.maquinaria_id) || [];
      list.push(srv);
      map.set(srv.maquinaria_id, list);
    });
    return map;
  }, [maquinariaServices]);

  // KPIs de Maquinaria y Taller
  const stats = useMemo(() => {
    const total = maquinaria.length;
    const operativas = maquinaria.filter((m) => m.estado === 'Operativa').length;
    const enService = maquinaria.filter((m) => m.estado === 'En Service').length;
    const fueraServicio = maquinaria.filter((m) => m.estado === 'Fuera de servicio').length;
    const tractores = maquinaria.filter(
      (m) => m.categoria === 'Tractores y Autopropulsados'
    ).length;
    const implementos = maquinaria.filter(
      (m) => m.categoria === 'Implementos y Maquinaria Agrícola'
    ).length;
    const herramientas = maquinaria.filter(
      (m) => m.categoria === 'Herramientas y Equipos Menores'
    ).length;

    const totalRepuestos = maquinariaRepuestos.length;
    const repuestosConNumero = maquinariaRepuestos.filter(
      (r) => r.numero_parte && r.numero_parte.trim() !== ''
    ).length;

    const totalServices = maquinariaServices.length;
    const costoServicesUsd = maquinariaServices.reduce(
      (acc, s) => acc + (Number(s.costo_usd) || 0),
      0
    );
    const costoServicesArs = maquinariaServices.reduce(
      (acc, s) => acc + (Number(s.costo_ars) || 0),
      0
    );

    return {
      total,
      operativas,
      enService,
      fueraServicio,
      tractores,
      implementos,
      herramientas,
      totalRepuestos,
      repuestosConNumero,
      totalServices,
      costoServicesUsd,
      costoServicesArs,
    };
  }, [maquinaria, maquinariaRepuestos, maquinariaServices]);

  // Filtrado de maquinaria
  const filteredMaquinaria = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return maquinaria.filter((m) => {
      if (filterCategoria !== 'TODAS' && m.categoria !== filterCategoria) return false;
      if (filterEstado !== 'TODOS' && m.estado !== filterEstado) return false;
      if (!q) return true;

      const matchMaq =
        (m.nombre || '').toLowerCase().includes(q) ||
        (m.codigo_ficha || '').toLowerCase().includes(q) ||
        (m.otro_nombre || '').toLowerCase().includes(q) ||
        (m.notas || '').toLowerCase().includes(q);
      if (matchMaq) return true;

      // Buscar también dentro de sus componentes o números de parte
      const reps = repuestosPorMaq.get(m.id) || [];
      return reps.some(
        (r) =>
          (r.componente || '').toLowerCase().includes(q) ||
          (r.marca_modelo_compatible || '').toLowerCase().includes(q) ||
          (r.numero_parte || '').toLowerCase().includes(q) ||
          (r.proveedor || '').toLowerCase().includes(q)
      );
    });
  }, [maquinaria, filterCategoria, filterEstado, searchTerm, repuestosPorMaq]);

  const selectedMaq = useMemo(
    () => maquinaria.find((m) => m.id === selectedMaqId) || null,
    [maquinaria, selectedMaqId]
  );

  // Abrir modal de Ficha Técnica
  function openFichaMaquinaria(maq, initialTab = 'repuestos') {
    setSelectedMaqId(maq.id);
    setFichaTab(initialTab);
    setEditedMaqHeader({
      nombre: maq.nombre || '',
      otro_nombre: maq.otro_nombre || '',
      estado: maq.estado || 'Operativa',
      horas_km_actuales: maq.horas_km_actuales || '',
      fecha_compra: maq.fecha_compra || '',
      responsable: maq.responsable || '',
      notas: maq.notas || '',
    });
    const reps = repuestosPorMaq.get(maq.id) || [];
    const repMap = {};
    reps.forEach((r) => {
      repMap[r.id] = {
        componente: r.componente || '',
        marca_modelo_compatible: r.marca_modelo_compatible || '',
        numero_parte: r.numero_parte || '',
        proveedor: r.proveedor || '',
        notas: r.notas || '',
      };
    });
    setEditedRepuestos(repMap);
  }

  // Cambiar Estado directo desde la tabla (Auto-Guardado Inmediato)
  async function handleQuickEstadoChange(maq, nuevoEstado) {
    setAutoSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('maquinaria')
        .update({ estado: nuevoEstado })
        .eq('id', maq.id);
      if (error) throw error;
      setAutoSaveStatus('saved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
      await onRefresh();
    } catch (err) {
      console.error('Error al actualizar estado:', err);
      setAutoSaveStatus('error');
      notify(`Error al actualizar estado: ${err.message}`, 'error');
    }
  }

  // Auto-guardado de Horas/Km con debounce de 700ms y onBlur
  const handleHorasChange = (maq, val) => {
    setInlineHoras((prev) => ({ ...prev, [maq.id]: val }));
    if (debounceHorasTimersRef.current[maq.id]) {
      clearTimeout(debounceHorasTimersRef.current[maq.id]);
    }
    debounceHorasTimersRef.current[maq.id] = setTimeout(() => {
      delete debounceHorasTimersRef.current[maq.id];
      autoSaveHorasKm(maq, val);
    }, 700);
  };

  const handleHorasBlur = (maq) => {
    if (debounceHorasTimersRef.current[maq.id]) {
      clearTimeout(debounceHorasTimersRef.current[maq.id]);
      delete debounceHorasTimersRef.current[maq.id];
      autoSaveHorasKm(maq, inlineHoras[maq.id]);
    }
  };

  async function autoSaveHorasKm(maq, val) {
    if (val === undefined) return;
    const trimmed = String(val).trim();
    if (trimmed === (maq.horas_km_actuales || '').trim()) return;

    setAutoSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('maquinaria')
        .update({ horas_km_actuales: trimmed })
        .eq('id', maq.id);
      if (error) throw error;
      setAutoSaveStatus('saved');
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2000);
      await onRefresh();
    } catch (err) {
      console.error('Error al guardar horas/km:', err);
      setAutoSaveStatus('error');
      notify(`Error al guardar horas/km: ${err.message}`, 'error');
    }
  }

  // Alias compatible
  async function handleQuickHorasSave(maq) {
    await autoSaveHorasKm(maq, inlineHoras[maq.id]);
  }

  // Guardar cabecera y repuestos de la Ficha Técnica
  async function handleSaveFichaCompleta() {
    if (!selectedMaq || !editedMaqHeader) return;
    setSaving(true);
    try {
      const { error: errMaq } = await supabase
        .from('maquinaria')
        .update({
          nombre: editedMaqHeader.nombre.trim() || selectedMaq.nombre,
          otro_nombre: editedMaqHeader.otro_nombre.trim(),
          estado: editedMaqHeader.estado,
          horas_km_actuales: editedMaqHeader.horas_km_actuales.trim(),
          fecha_compra: editedMaqHeader.fecha_compra || null,
          responsable: editedMaqHeader.responsable.trim(),
          notas: editedMaqHeader.notas.trim(),
        })
        .eq('id', selectedMaq.id);
      if (errMaq) throw errMaq;

      // Actualizar cada fila de repuesto editada
      const reps = repuestosPorMaq.get(selectedMaq.id) || [];
      for (const r of reps) {
        const edit = editedRepuestos[r.id];
        if (!edit) continue;
        if (
          edit.componente !== (r.componente || '') ||
          edit.marca_modelo_compatible !== (r.marca_modelo_compatible || '') ||
          edit.numero_parte !== (r.numero_parte || '') ||
          edit.proveedor !== (r.proveedor || '') ||
          edit.notas !== (r.notas || '')
        ) {
          const { error: errRep } = await supabase
            .from('maquinaria_repuestos')
            .update({
              componente: edit.componente.trim() || r.componente,
              marca_modelo_compatible: edit.marca_modelo_compatible.trim(),
              numero_parte: edit.numero_parte.trim(),
              proveedor: edit.proveedor.trim(),
              notas: edit.notas.trim(),
            })
            .eq('id', r.id);
          if (errRep) throw errRep;
        }
      }

      notify(`Ficha técnica y repuestos de "${selectedMaq.nombre}" guardados.`);
      await onRefresh();
    } catch (err) {
      notify(`Error al guardar ficha: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Exportar Ficha Técnica de Máquina + Tabla de Repuestos Específicos (PDF para Taller)
  async function handleExportFichaMaquinaPDF() {
    if (!selectedMaq) return;
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const logoDataUrl = await getSanJoseLogoDataUrl();
      const hdr = editedMaqHeader || selectedMaq;
      let y = drawSanJosePdfHeader(doc, {
        title: `FICHA TÉCNICA Y REPUESTOS — ${selectedMaq.codigo_ficha || ''} ${hdr.nombre || selectedMaq.nombre}`,
        subtitle: `${selectedMaq.categoria} · Estado: ${hdr.estado || 'Operativa'} · Horas/Km: ${hdr.horas_km_actuales || 'S/D'}`,
        fechaOperacion,
        logoDataUrl,
      });

      // Bloque de datos de cabecera de la máquina
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(14, y, 182, 22, 2, 2, 'FD');

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`Equipo: ${hdr.nombre || selectedMaq.nombre}`, 18, y + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Otro nombre / Alias: ${hdr.otro_nombre || '-'}`, 18, y + 12);
      doc.text(`Responsable asignado: ${hdr.responsable || '-'}`, 18, y + 18);

      doc.text(`Código Ficha: ${selectedMaq.codigo_ficha || '-'}`, 115, y + 6);
      doc.text(`Horas / Km actuales: ${hdr.horas_km_actuales || '-'}`, 115, y + 12);
      doc.text(`Estado actual: ${hdr.estado || 'Operativa'}`, 115, y + 18);
      y += 27;

      // Tabla Ficha 1: Repuestos Específicos
      doc.setFillColor(6, 78, 59);
      doc.rect(14, y, 182, 7.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text('COMPONENTE / FILTRO / CORREA', 16, y + 5);
      doc.text('MARCA / MODELO COMPATIBLE', 68, y + 5);
      doc.text('N° DE PARTE ESPECÍFICO', 118, y + 5);
      doc.text('PROVEEDOR', 156, y + 5);
      doc.text('NOTAS', 180, y + 5);
      y += 7.5;

      const reps = repuestosPorMaq.get(selectedMaq.id) || [];
      reps.forEach((rep, idx) => {
        const edit = editedRepuestos[rep.id] || rep;
        if (y > 250) {
          doc.addPage();
          y = 18;
        }
        if (idx % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y, 182, 8, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(14, y + 8, 196, y + 8);

        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(edit.componente || '').slice(0, 28), 16, y + 5.2);

        doc.setFont('helvetica', 'normal');
        doc.text(String(edit.marca_modelo_compatible || 'Completar...').slice(0, 26), 68, y + 5.2);
        doc.setFont('courier', 'bold');
        doc.text(String(edit.numero_parte || 'S/N').slice(0, 20), 118, y + 5.2);
        doc.setFont('helvetica', 'normal');
        doc.text(String(edit.proveedor || '-').slice(0, 14), 156, y + 5.2);
        doc.text(String(edit.notas || '').slice(0, 10), 180, y + 5.2);
        y += 8;
      });

      drawSanJoseSignatureFooter(doc, y + 10, {
        leftLabel: 'Encargado de Taller / Maquinaria',
        rightLabel: 'Control Administración San José',
      });

      const safeName = String(selectedMaq.codigo_ficha || selectedMaq.nombre || 'Maquina').replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );
      doc.save(`Ficha_Tecnica_${safeName}_SanJose.pdf`);
      notify(`Ficha técnica de "${selectedMaq.nombre}" exportada en PDF.`);
    } catch (err) {
      notify(`Error al exportar PDF de ficha: ${err.message}`, 'error');
    }
  }

  // Agregar nuevo componente / repuesto a una máquina
  async function handleAddRepuesto(e) {
    e.preventDefault();
    if (!selectedMaq || !newRepuesto.componente.trim()) {
      notify('Ingresá el nombre del componente o repuesto.', 'error');
      return;
    }
    setSaving(true);
    try {
      const currentList = repuestosPorMaq.get(selectedMaq.id) || [];
      const nextOrden = currentList.length + 1;
      const { data, error } = await supabase
        .from('maquinaria_repuestos')
        .insert({
          maquinaria_id: selectedMaq.id,
          orden: nextOrden,
          componente: newRepuesto.componente.trim(),
          marca_modelo_compatible: newRepuesto.marca_modelo_compatible.trim(),
          numero_parte: newRepuesto.numero_parte.trim(),
          proveedor: newRepuesto.proveedor.trim(),
          notas: newRepuesto.notas.trim(),
        })
        .select()
        .single();
      if (error) throw error;

      if (data) {
        setEditedRepuestos((prev) => ({
          ...prev,
          [data.id]: {
            componente: data.componente || '',
            marca_modelo_compatible: data.marca_modelo_compatible || '',
            numero_parte: data.numero_parte || '',
            proveedor: data.proveedor || '',
            notas: data.notas || '',
          },
        }));
      }
      setNewRepuesto({
        componente: '',
        marca_modelo_compatible: '',
        numero_parte: '',
        proveedor: '',
        notas: '',
      });
      notify(`Componente agregado a "${selectedMaq.nombre}".`);
      await onRefresh();
    } catch (err) {
      notify(`Error al agregar repuesto: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Eliminar un componente / repuesto
  async function handleDeleteRepuesto(repId) {
    const rep = (maquinariaRepuestos || []).find((r) => r.id === repId);
    const ok = await confirmAction({
      title: `¿Eliminar repuesto "${rep?.nombre_pieza || 'este repuesto'}"?`,
      description: 'El componente será removido de la ficha técnica de la maquinaria.',
      confirmText: 'Sí, eliminar repuesto',
      variant: 'danger',
    });
    if (!ok) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('maquinaria_repuestos')
        .delete()
        .eq('id', repId);
      if (error) throw error;
      notify('Componente eliminado de la ficha.');
      await onRefresh();
    } catch (err) {
      notify(`Error al eliminar repuesto: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Alternar casilla en Ficha 2 — Control Mensual (ENE..DIC)
  async function handleToggleControlMensual(rep, mesKey) {
    const currentCtrl = rep.control_mensual || {};
    const valActual = currentCtrl[mesKey] || '';
    // Ciclo: '' -> '✓' -> 'CAMBIO' -> ''
    const nextVal = valActual === '' ? '✓' : valActual === '✓' ? 'CAMBIO' : '';
    const updatedCtrl = { ...currentCtrl, [mesKey]: nextVal };

    try {
      const { error } = await supabase
        .from('maquinaria_repuestos')
        .update({ control_mensual: updatedCtrl })
        .eq('id', rep.id);
      if (error) throw error;
      await onRefresh();
    } catch (err) {
      notify(`Error al actualizar control mensual: ${err.message}`, 'error');
    }
  }

  // Abrir modal para registrar un Service / Mantenimiento
  function openNewServiceModal(maq = null) {
    const defaultMaq = maq || maquinaria[0] || null;
    setServiceModalMaq(defaultMaq);
    setServiceForm({
      maquinaria_id: defaultMaq ? String(defaultMaq.id) : '',
      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      tipo_service: 'Mantenimiento / Cambio de Repuesto',
      horas_km: defaultMaq?.horas_km_actuales || '',
      repuesto_colocado: '',
      numero_parte_usado: '',
      proveedor_taller: '',
      moneda_carga: 'ARS',
      costo_input: '',
      impactar_gastos: true,
      observaciones: '',
      tareas_items: [{ detalle: 'Cambio de Aceite y Filtros', repuesto: '', numero_parte: '', costo: '' }],
      proximo_service_horas_km: '',
      proximo_service_fecha: '',
    });
  }

  // Guardar Service / Mantenimiento e impactar opcionalmente en gastos_campo
  async function handleSaveService(e) {
    e.preventDefault();
    const maqIdNum = parseInt(serviceForm.maquinaria_id, 10);
    const maqObj = maquinaria.find((m) => m.id === maqIdNum);
    if (!maqObj) {
      notify('Seleccioná una máquina o equipo válido.', 'error');
      return;
    }

    const tc = Number(dolarRef) > 0 ? Number(dolarRef) : 1540;
    const items = Array.isArray(serviceForm.tareas_items) ? serviceForm.tareas_items : [];
    const repuestosConsolidados = items
      .map((it) => it.detalle?.trim() || it.repuesto?.trim())
      .filter(Boolean)
      .join(', ');
    const partesConsolidadas = items
      .map((it) => it.numero_parte?.trim())
      .filter(Boolean)
      .join(', ');

    const sumaCostosItems = items.reduce((acc, it) => acc + (parseFloat(it.costo) || 0), 0);
    const rawCosto = parseFloat(serviceForm.costo_input) || sumaCostosItems;
    const costoArs = serviceForm.moneda_carga === 'ARS' ? rawCosto : rawCosto * tc;
    const costoUsd = serviceForm.moneda_carga === 'USD' ? rawCosto : rawCosto / tc;

    const repuestoFinal = serviceForm.repuesto_colocado.trim() || repuestosConsolidados;
    const parteFinal = serviceForm.numero_parte_usado.trim() || partesConsolidadas;

    setSaving(true);
    try {
      let gastoCampoId = null;

      // Si tiene costo > 0 y está tildado impactar en gastos_campo
      if (rawCosto > 0 && serviceForm.impactar_gastos) {
        const conceptoDetalle = [
          `Service / Taller: ${maqObj.nombre}`,
          repuestoFinal ? `(${repuestoFinal})` : '',
        ]
          .filter(Boolean)
          .join(' ');

        const { data: gastoIns, error: errGasto } = await supabase
          .from('gastos_campo')
          .insert({
            fecha: serviceForm.fecha || new Date().toISOString().slice(0, 10),
            rubro: 'Infraestructura / Proveedores Externos',
            concepto: conceptoDetalle,
            proveedor: serviceForm.proveedor_taller.trim() || null,
            moneda_carga: serviceForm.moneda_carga,
            tipo_cambio: tc,
            monto_ars: Number(costoArs.toFixed(2)),
            monto_usd: Number(costoUsd.toFixed(2)),
            observaciones:
              serviceForm.observaciones.trim() ||
              `Generado desde Maquinaria & Taller (${serviceForm.tipo_service})`,
          })
          .select()
          .single();

        if (errGasto) throw errGasto;
        gastoCampoId = gastoIns?.id || null;
      }

      const { error: errSrv } = await supabase.from('maquinaria_services').insert({
        maquinaria_id: maqObj.id,
        maquinaria_nombre: maqObj.nombre,
        fecha: serviceForm.fecha || new Date().toISOString().slice(0, 10),
        tipo_service: serviceForm.tipo_service,
        horas_km: serviceForm.horas_km.trim(),
        repuesto_colocado: repuestoFinal,
        numero_parte_usado: parteFinal,
        tareas_items: items,
        proximo_service_horas_km: serviceForm.proximo_service_horas_km?.trim() || null,
        proximo_service_fecha: serviceForm.proximo_service_fecha || null,
        proveedor_taller: serviceForm.proveedor_taller.trim(),
        moneda_carga: serviceForm.moneda_carga,
        tipo_cambio: tc,
        costo_ars: Number(costoArs.toFixed(2)),
        costo_usd: Number(costoUsd.toFixed(2)),
        gasto_campo_id: gastoCampoId,
        observaciones: serviceForm.observaciones.trim(),
      });
      if (errSrv) throw errSrv;

      // Si ingresó nuevas horas/km actuales, actualizar en la ficha de la máquina
      if (
        serviceForm.horas_km.trim() &&
        serviceForm.horas_km.trim() !== (maqObj.horas_km_actuales || '')
      ) {
        await supabase
          .from('maquinaria')
          .update({ horas_km_actuales: serviceForm.horas_km.trim() })
          .eq('id', maqObj.id);
      }

      notify(
        rawCosto > 0 && serviceForm.impactar_gastos
          ? `Service registrado en "${maqObj.nombre}" e imputado automáticamente en Costos & Finanzas.`
          : `Service / mantenimiento registrado en "${maqObj.nombre}".`
      );
      setServiceModalMaq(null);
      await onRefresh();
    } catch (err) {
      notify(`Error al registrar service: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Crear nuevo equipo en el inventario
  async function handleCreateMaquinaria(e) {
    e.preventDefault();
    if (!newMaqForm.nombre.trim()) {
      notify('Ingresá el nombre de la máquina o equipo.', 'error');
      return;
    }
    setSaving(true);
    try {
      const nextOrden = maquinaria.length + 1;
      const codigo =
        newMaqForm.codigo_ficha.trim() || `EQ-${String(nextOrden).padStart(2, '0')}`;
      const { error } = await supabase.from('maquinaria').insert({
        orden: nextOrden,
        codigo_ficha: codigo,
        categoria: newMaqForm.categoria,
        nombre: newMaqForm.nombre.trim(),
        otro_nombre: newMaqForm.otro_nombre.trim(),
        estado: newMaqForm.estado,
        horas_km_actuales: newMaqForm.horas_km_actuales.trim(),
        responsable: newMaqForm.responsable.trim(),
        notas: newMaqForm.notas.trim(),
      });
      if (error) throw error;
      notify(`Equipo "${newMaqForm.nombre.trim()}" incorporado al inventario.`);
      setShowNewMaqModal(false);
      setNewMaqForm({
        codigo_ficha: '',
        categoria: 'Tractores y Autopropulsados',
        nombre: '',
        otro_nombre: '',
        estado: 'Operativa',
        horas_km_actuales: '',
        responsable: '',
        notas: '',
      });
      await onRefresh();
    } catch (err) {
      notify(`Error al crear equipo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Encabezado Ejecutivo */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 tracking-wide uppercase">
              Parque de Maquinaria & Taller
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Fichas técnicas de repuestos, control mensual y registro de services
            </span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 mt-1">
            Inventario de Maquinaria, Repuestos y Mantenimiento ({stats.total} equipos)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => openNewServiceModal(null)}
            className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Wrench className="w-4 h-4" />
            + Registrar Service / Mantenimiento
          </button>
          <button
            type="button"
            onClick={() => setShowNewMaqModal(true)}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            + Nuevo Equipo
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Parque de Maquinaria */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Equipos en Inventario
            </span>
            <Wrench className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {stats.total}{' '}
            <span className="text-xs font-semibold text-slate-600">máquinas</span>
          </div>
          <div className="text-[11px] text-slate-600 font-medium mt-1">
            {stats.tractores} Tractores · {stats.implementos} Implementos ·{' '}
            {stats.herramientas} Menores
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Estado Operativo
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-800 mt-1">
            {stats.operativas} / {stats.total}{' '}
            <span className="text-xs font-semibold text-slate-600">operativas</span>
          </div>
          <div className="text-[11px] text-slate-600 font-medium mt-1">
            {stats.enService} en service · {stats.fueraServicio} fuera de servicio
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Componentes & Repuestos (Ficha 1)
            </span>
            <Settings className="w-4 h-4 text-sky-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {stats.totalRepuestos}{' '}
            <span className="text-xs font-semibold text-slate-600">ítems</span>
          </div>
          <div className="text-[11px] text-slate-600 font-medium mt-1">
            {stats.repuestosConNumero} con N° de parte específico cargado
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Services & Gastos de Taller
            </span>
            <DollarSign className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">
            US$ {stats.costoServicesUsd.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-slate-600 font-medium mt-1">
            {stats.totalServices} services registrados ($ {' '}
            {stats.costoServicesArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS)
          </div>
        </div>
      </div>

      {/* Pestañas del Módulo */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/90 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('inventario')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              subTab === 'inventario'
                ? 'bg-emerald-950 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            Fichas por Máquina ({maquinaria.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('services')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              subTab === 'services'
                ? 'bg-emerald-950 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Historial de Services y Taller ({maquinariaServices.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('protocolo')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              subTab === 'protocolo'
                ? 'bg-emerald-950 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Protocolo de Uso (Oficina del Campo)
          </button>
          <button
            type="button"
            onClick={() => setShowGeminiRepuestoModal(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-950 via-slate-900 to-slate-950 hover:from-amber-900 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm border border-amber-500/30 transition hover:scale-105"
            title="Escanear pieza, etiqueta o factura con Gemini IA"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Cargar Repuesto con IA
          </button>
        </div>

        {subTab === 'inventario' && (
          <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl justify-end">
            {/* Indicador de Auto-Guardado Intuitivo */}
            {autoSaveStatus === 'saving' && (
              <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1.5 animate-pulse shrink-0">
                <span className="w-2 h-2 rounded-full border-2 border-amber-600 border-t-transparent animate-spin shrink-0" />
                Guardando...
              </span>
            )}
            {autoSaveStatus === 'saved' && (
              <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200 flex items-center gap-1.5 shrink-0 transition-all duration-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ✓ Cambios guardados
              </span>
            )}
            {autoSaveStatus === 'error' && (
              <span className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-red-50 text-red-900 border border-red-200 flex items-center gap-1.5 shrink-0">
                ✕ Error al auto-guardar
              </span>
            )}
            <div className="relative flex-1 min-w-[210px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar máquina, repuesto, filtro, N° de parte..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-600"
              />
            </div>

            <select
              value={filterEstado}
              onChange={(e) => setFilterEstado(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-700"
            >
              <option value="TODOS">Todos los estados</option>
              {ESTADOS_MAQUINARIA.map((est) => (
                <option key={est} value={est}>
                  {est}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* SUB-TAB 1: INVENTARIO Y FICHAS POR MÁQUINA */}
      {subTab === 'inventario' && (
        <div className="space-y-4">
          {/* Selector de las 3 Categorías Oficiales */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterCategoria('TODAS')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                filterCategoria === 'TODAS'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Todas las Categorías ({maquinaria.length})
            </button>
            {CATEGORIAS_MAQUINARIA.map((cat) => {
              const count = maquinaria.filter((m) => m.categoria === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFilterCategoria(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                    filterCategoria === cat
                      ? 'bg-emerald-800 text-white border-emerald-800 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>

          {/* Tabla de Equipos */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-3 px-4">Ficha</th>
                    <th className="py-3 px-4">Equipo / Máquina</th>
                    <th className="py-3 px-4">Categoría</th>
                    <th className="py-3 px-4">Horas / Km Actuales</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4">Repuestos (Ficha 1)</th>
                    <th className="py-3 px-4 text-right">Acciones Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredMaquinaria.map((maq) => {
                    const reps = repuestosPorMaq.get(maq.id) || [];
                    const srvs = servicesPorMaq.get(maq.id) || [];
                    const conParte = reps.filter(
                      (r) => r.numero_parte && r.numero_parte.trim() !== ''
                    ).length;
                    const horasVal =
                      inlineHoras[maq.id] !== undefined
                        ? inlineHoras[maq.id]
                        : maq.horas_km_actuales || '';

                    return (
                      <tr key={maq.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono text-[11px] font-bold text-slate-500">
                          {maq.codigo_ficha || `#${maq.id}`}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 text-xs">{maq.nombre}</div>
                          {maq.otro_nombre && (
                            <div className="text-[11px] text-slate-500">
                              Alias: {maq.otro_nombre}
                            </div>
                          )}
                          {srvs.length > 0 && (
                            <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">
                              Último service: {formatFechaAR(srvs[0].fecha)} ({srvs[0].repuesto_colocado || srvs[0].tipo_service})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getCategoriaBadgeStyle(
                              maq.categoria
                            )}`}
                          >
                            {maq.categoria}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 max-w-[150px]">
                            <input
                              type="text"
                              value={horasVal}
                              onChange={(e) => handleHorasChange(maq, e.target.value)}
                              onBlur={() => handleHorasBlur(maq)}
                              placeholder="Ej: 4.250 hs"
                              className="w-full px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-slate-50/70 focus:bg-white focus:border-emerald-600 focus:outline-none font-semibold transition"
                              title="Horas o kilómetros acumulados (se auto-guarda al escribir)"
                            />
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={maq.estado || 'Operativa'}
                            onChange={(e) => handleQuickEstadoChange(maq, e.target.value)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${getEstadoBadgeStyle(
                              maq.estado || 'Operativa'
                            )}`}
                          >
                            {ESTADOS_MAQUINARIA.map((est) => (
                              <option key={est} value={est}>
                                {est}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">
                              {reps.length} componentes
                            </span>
                            {conParte > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                                {conParte} N° parte
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 font-medium truncate max-w-[230px]">
                            {reps
                              .slice(0, 3)
                              .map((r) => r.componente)
                              .join(' · ')}
                            {reps.length > 3 ? '...' : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openFichaMaquinaria(maq, 'repuestos')}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold flex items-center gap-1 transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              Ficha & Repuestos
                            </button>
                            <button
                              type="button"
                              onClick={() => openNewServiceModal(maq)}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 text-[11px] font-bold flex items-center gap-1 transition-colors"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              + Service
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: HISTORIAL DE SERVICES Y MANTENIMIENTOS */}
      {subTab === 'services' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Historial de Services, Cambios de Repuestos y Mantenimientos
              </h3>
              <p className="text-xs text-slate-500">
                Los services con costo impactan automáticamente en Costos & Finanzas bajo el rubro Infraestructura / Proveedores Externos.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openNewServiceModal(null)}
              className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Registrar Nuevo Service
            </button>
          </div>

          {maquinariaServices.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Wrench className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-bold text-slate-700">
                Aún no hay services ni mantenimientos registrados
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Usá el botón "+ Registrar Service / Mantenimiento" para asentar un cambio de filtros, aceite o arreglo de cualquier tractor, implemento o herramienta.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Equipo / Máquina</th>
                    <th className="py-3 px-4">Tipo de Intervención</th>
                    <th className="py-3 px-4">Horas / Km</th>
                    <th className="py-3 px-4">Repuesto / Componente</th>
                    <th className="py-3 px-4">Proveedor / Taller</th>
                    <th className="py-3 px-4 text-right">Costo ARS</th>
                    <th className="py-3 px-4 text-right">Costo USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {maquinariaServices.map((srv) => (
                    <tr key={srv.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-700">{formatFechaAR(srv.fecha)}</td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {srv.maquinaria_nombre}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {srv.tipo_service}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {srv.horas_km || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800">
                          {srv.repuesto_colocado || '-'}
                        </div>
                        {srv.numero_parte_usado && (
                          <div className="text-[11px] text-slate-500">
                            N° Parte: {srv.numero_parte_usado}
                          </div>
                        )}
                        {Array.isArray(srv.tareas_items) && srv.tareas_items.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {srv.tareas_items.map((it, idx) => (
                              <span key={idx} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 text-[10px] font-bold">
                                ✓ {it.detalle || it.repuesto} {it.numero_parte ? `(#${it.numero_parte})` : ''} {it.costo ? `· $${Number(it.costo).toLocaleString('es-AR')}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {(srv.proximo_service_horas_km || srv.proximo_service_fecha) && (
                          <div className="text-[10px] font-black text-amber-800 mt-1">
                            ⏰ Próx.: {srv.proximo_service_horas_km || ''} {srv.proximo_service_fecha ? `(${srv.proximo_service_fecha})` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {srv.proveedor_taller || '-'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-800">
                        {Number(srv.costo_ars) > 0
                          ? `$ ${Number(srv.costo_ars).toLocaleString('es-AR', {
                              maximumFractionDigits: 0,
                            })}`
                          : '-'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-800">
                        {Number(srv.costo_usd) > 0
                          ? `US$ ${Number(srv.costo_usd).toLocaleString('es-AR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: PROTOCOLO DE USO OFICIAL (Extraído de 00_Portada_Protocolo_de_Uso.pdf) */}
      {subTab === 'protocolo' && (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-base font-extrabold text-emerald-950">
              Protocolo de uso — Sistema de fichas por máquina (Campo San José)
            </h3>
            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <strong className="text-slate-900">1. Cada máquina tiene 2 fichas integradas:</strong>{' '}
                <strong>Ficha 1</strong> = repuestos específicos (consulta permanente).{' '}
                <strong>Ficha 2</strong> = control mensual de mantenimiento (Ene–Dic).
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <strong className="text-slate-900">2. Ficha 1 — Repuestos específicos:</strong>{' '}
                Es una guía de consulta; ahí se anota, a medida que se averigua con el proveedor o el taller, qué marca/modelo compatible y N° de parte exacto usa cada componente.
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <strong className="text-slate-900">3. Ficha 2 — Control mensual:</strong>{' '}
                Una vez por mes, recorrer y revisar cada componente. En la columna del mes: tildar (✓) si está bien, o marcar cambio + registrar el Service con fecha y N° de repuesto colocado.
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                <strong className="text-slate-900">4. Varios modelos posibles de un mismo repuesto:</strong>{' '}
                Anotarlos todos en la Ficha 1, columna &apos;Marca / Modelo compatible&apos; (ej: &apos;Mann W940 o Fram PH16&apos;).
              </div>
            </div>
          </div>

          <div className="space-y-3 bg-emerald-950/5 rounded-2xl p-4 border border-emerald-900/15">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-950">
              Resumen de Rubros Inventariados
            </h4>
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <div className="font-bold text-slate-900">Tractores y Autopropulsados</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  John Deere 5082E, 6415, 5060, 7500, Rotoenfardadora JD 566 y Chery 180.
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <div className="font-bold text-slate-900">Implementos y Maquinaria Agrícola</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Rastra Giaroli RSP 160/100, Rolo Giaroli RCL 5,50, Rolo Pesce 600, Desmalezadora Mainero 6027, Niveladora Grosspal NA12, Labradora Ombú ROP 4900, Pala Grosspal Nova 150, Desmalezadora chica Grosspal.
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200">
                <div className="font-bold text-slate-900">Herramientas y Equipos Menores</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Sopladora Lusqtoff, Motosierras Stihl MS290 y Grandenplus, 4 Bordeadoras (Villa CX50, Lusqtoff LD52-7, LP-43, S/D), Taladro Sensei, Moledora Lusqtoff, Soldadora Salkor 200A, Compresor Dogo, Generador Villa PX 5500, Hidrolavadoras Kärcher HD 5/11 C y Daewoo.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE FICHA TÉCNICA POR MÁQUINA (FICHA 1 + FICHA 2 + HISTORIAL) */}
      {selectedMaq && editedMaqHeader && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Cabecera del Modal */}
            <div className="px-6 py-4 bg-emerald-950 text-white flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2 text-[11px] text-emerald-300 font-bold uppercase tracking-wider">
                  <span>{selectedMaq.codigo_ficha}</span>
                  <span>·</span>
                  <span>{selectedMaq.categoria}</span>
                </div>
                <h3 className="text-lg font-extrabold mt-0.5">{selectedMaq.nombre}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openNewServiceModal(selectedMaq)}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  + Registrar Service
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMaqId(null)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Datos Generales Editables de la Máquina */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 shrink-0">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                  Otro nombre / Alias en campo
                </label>
                <input
                  type="text"
                  value={editedMaqHeader.otro_nombre}
                  onChange={(e) =>
                    setEditedMaqHeader({ ...editedMaqHeader, otro_nombre: e.target.value })
                  }
                  placeholder="Ej: Tractor verde chico"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                  Horas / Km actuales
                </label>
                <input
                  type="text"
                  value={editedMaqHeader.horas_km_actuales}
                  onChange={(e) =>
                    setEditedMaqHeader({
                      ...editedMaqHeader,
                      horas_km_actuales: e.target.value,
                    })
                  }
                  placeholder="Ej: 4.120 hs"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                  Estado actual
                </label>
                <select
                  value={editedMaqHeader.estado}
                  onChange={(e) =>
                    setEditedMaqHeader({ ...editedMaqHeader, estado: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-bold"
                >
                  {ESTADOS_MAQUINARIA.map((est) => (
                    <option key={est} value={est}>
                      {est}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                  Responsable asignado
                </label>
                <input
                  type="text"
                  value={editedMaqHeader.responsable}
                  onChange={(e) =>
                    setEditedMaqHeader({ ...editedMaqHeader, responsable: e.target.value })
                  }
                  placeholder="Nombre del encargado"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                  Fecha de compra
                </label>
                <input
                  type="date"
                  value={editedMaqHeader.fecha_compra || ''}
                  onChange={(e) =>
                    setEditedMaqHeader({ ...editedMaqHeader, fecha_compra: e.target.value })
                  }
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                />
              </div>
            </div>

            {/* Selector de Pestaña dentro de la Ficha */}
            <div className="px-6 pt-3 pb-2 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFichaTab('repuestos')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    fichaTab === 'repuestos'
                      ? 'bg-emerald-800 !text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Ficha 1 · Repuestos Específicos (
                  {(repuestosPorMaq.get(selectedMaq.id) || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFichaTab('mensual')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    fichaTab === 'mensual'
                      ? 'bg-emerald-800 !text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Ficha 2 · Control Mensual (Ene–Dic)
                </button>
                <button
                  type="button"
                  onClick={() => setFichaTab('historial')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    fichaTab === 'historial'
                      ? 'bg-emerald-800 !text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Services de esta Máquina (
                  {(servicesPorMaq.get(selectedMaq.id) || []).length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportFichaMaquinaPDF}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm"
                  title="Descargar Ficha Técnica y tabla de repuestos en PDF con el logo del establecimiento"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Imprimir / PDF Ficha
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveFichaCompleta}
                  className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" />
                  Guardar Cambios en Ficha
                </button>
              </div>
            </div>

            {/* Contenido desplazable de la Ficha */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              {fichaTab === 'repuestos' && (
                <>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-emerald-950 text-white text-[11px] font-bold uppercase">
                          <th className="py-2.5 px-3">Componente</th>
                          <th className="py-2.5 px-3">Marca / Modelo Compatible</th>
                          <th className="py-2.5 px-3">N° de Parte Específico</th>
                          <th className="py-2.5 px-3">Proveedor</th>
                          <th className="py-2.5 px-3">Notas</th>
                          <th className="py-2.5 px-3 text-right">Quitar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {(repuestosPorMaq.get(selectedMaq.id) || []).map((rep) => {
                          const edit = editedRepuestos[rep.id] || {
                            componente: rep.componente || '',
                            marca_modelo_compatible: rep.marca_modelo_compatible || '',
                            numero_parte: rep.numero_parte || '',
                            proveedor: rep.proveedor || '',
                            notas: rep.notas || '',
                          };
                          return (
                            <tr key={rep.id} className="hover:bg-slate-50">
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={edit.componente}
                                  onChange={(e) =>
                                    setEditedRepuestos((prev) => ({
                                      ...prev,
                                      [rep.id]: { ...edit, componente: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-bold text-slate-900 bg-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={edit.marca_modelo_compatible}
                                  onChange={(e) =>
                                    setEditedRepuestos((prev) => ({
                                      ...prev,
                                      [rep.id]: {
                                        ...edit,
                                        marca_modelo_compatible: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="Ej: Mann W940 o Fram PH16"
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={edit.numero_parte}
                                  onChange={(e) =>
                                    setEditedRepuestos((prev) => ({
                                      ...prev,
                                      [rep.id]: { ...edit, numero_parte: e.target.value },
                                    }))
                                  }
                                  placeholder="Código exacto"
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono bg-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={edit.proveedor}
                                  onChange={(e) =>
                                    setEditedRepuestos((prev) => ({
                                      ...prev,
                                      [rep.id]: { ...edit, proveedor: e.target.value },
                                    }))
                                  }
                                  placeholder="Casa de repuestos / Taller"
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={edit.notas}
                                  onChange={(e) =>
                                    setEditedRepuestos((prev) => ({
                                      ...prev,
                                      [rep.id]: { ...edit, notas: e.target.value },
                                    }))
                                  }
                                  placeholder="Observaciones..."
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white"
                                />
                              </td>
                              <td className="p-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRepuesto(rep.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  title="Eliminar componente"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Agregar nuevo componente a esta Ficha */}
                  <form
                    onSubmit={handleAddRepuesto}
                    className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="text-xs font-bold text-slate-800">
                      + Agregar Componente o Repuesto a la Ficha de {selectedMaq.nombre}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                      <input
                        type="text"
                        value={newRepuesto.componente}
                        onChange={(e) =>
                          setNewRepuesto({ ...newRepuesto, componente: e.target.value })
                        }
                        placeholder="Componente (ej: Correa poly-V)"
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                      />
                      <input
                        type="text"
                        value={newRepuesto.marca_modelo_compatible}
                        onChange={(e) =>
                          setNewRepuesto({
                            ...newRepuesto,
                            marca_modelo_compatible: e.target.value,
                          })
                        }
                        placeholder="Marca / Modelo compatible"
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      />
                      <input
                        type="text"
                        value={newRepuesto.numero_parte}
                        onChange={(e) =>
                          setNewRepuesto({ ...newRepuesto, numero_parte: e.target.value })
                        }
                        placeholder="N° de Parte específico"
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono"
                      />
                      <input
                        type="text"
                        value={newRepuesto.proveedor}
                        onChange={(e) =>
                          setNewRepuesto({ ...newRepuesto, proveedor: e.target.value })
                        }
                        placeholder="Proveedor"
                        className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      />
                      <button
                        type="submit"
                        disabled={saving}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar Fila
                      </button>
                    </div>
                  </form>
                </>
              )}

              {fichaTab === 'mensual' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-600 flex items-center justify-between">
                    <span>
                      Hacé clic en el casillero de cada mes para marcar:{' '}
                      <strong className="text-emerald-700">✓ Revisado sin novedad</strong> o{' '}
                      <strong className="text-amber-700">CAMBIO (repuesto reemplazado)</strong>.
                    </span>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-emerald-950 text-white text-[11px] font-bold uppercase">
                          <th className="py-2.5 px-3">Componente</th>
                          {MESES_CONTROL.map((m) => (
                            <th key={m.key} className="py-2.5 px-2 text-center">
                              {m.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {(repuestosPorMaq.get(selectedMaq.id) || []).map((rep) => {
                          const ctrl = rep.control_mensual || {};
                          return (
                            <tr key={rep.id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-bold text-slate-900">
                                {rep.componente}
                              </td>
                              {MESES_CONTROL.map((m) => {
                                const val = ctrl[m.key] || '';
                                return (
                                  <td key={m.key} className="p-1.5 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleControlMensual(rep, m.key)}
                                      className={`w-11 h-7 rounded-lg text-[10px] font-extrabold border transition-all ${
                                        val === '✓'
                                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                          : val === 'CAMBIO'
                                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                                          : 'bg-slate-50 text-slate-300 border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      {val || '—'}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {fichaTab === 'historial' && (
                <div className="space-y-3">
                  {(servicesPorMaq.get(selectedMaq.id) || []).length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                      No hay services registrados todavía para {selectedMaq.nombre}.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                            <th className="py-2.5 px-3">Fecha</th>
                            <th className="py-2.5 px-3">Intervención</th>
                            <th className="py-2.5 px-3">Horas / Km</th>
                            <th className="py-2.5 px-3">Repuesto Colocado</th>
                            <th className="py-2.5 px-3">Proveedor / Taller</th>
                            <th className="py-2.5 px-3 text-right">Costo ARS / USD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {(servicesPorMaq.get(selectedMaq.id) || []).map((s) => (
                            <tr key={s.id}>
                              <td className="py-2.5 px-3 font-semibold">{formatFechaAR(s.fecha)}</td>
                              <td className="py-2.5 px-3">{s.tipo_service}</td>
                              <td className="py-2.5 px-3 font-mono">{s.horas_km || '-'}</td>
                              <td className="py-2.5 px-3 font-bold">
                                {s.repuesto_colocado || '-'}
                              </td>
                              <td className="py-2.5 px-3">{s.proveedor_taller || '-'}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-800">
                                {Number(s.costo_ars) > 0
                                  ? `$ ${Number(s.costo_ars).toLocaleString('es-AR', {
                                      maximumFractionDigits: 0,
                                    })} (US$ ${Number(s.costo_usd).toFixed(0)})`
                                  : 'Sin costo'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL PARA REGISTRAR SERVICE / MANTENIMIENTO */}
      {serviceModalMaq !== null && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Mantenimiento & Taller
                </span>
                <h3 className="text-base font-extrabold">
                  Registrar Service / Cambio de Repuesto
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setServiceModalMaq(null)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Equipo / Máquina
                  </label>
                  <select
                    value={serviceForm.maquinaria_id}
                    onChange={(e) => {
                      const m = maquinaria.find((x) => String(x.id) === e.target.value);
                      setServiceForm({
                        ...serviceForm,
                        maquinaria_id: e.target.value,
                        horas_km: m?.horas_km_actuales || serviceForm.horas_km,
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                  >
                    {maquinaria.map((m) => (
                      <option key={m.id} value={m.id}>
                        [{m.codigo_ficha}] {m.nombre} ({m.categoria})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha del Service
                  </label>
                  <input
                    type="date"
                    value={serviceForm.fecha}
                    onChange={(e) =>
                      setServiceForm({ ...serviceForm, fecha: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Horas / Km al momento del Service
                  </label>
                  <input
                    type="text"
                    value={serviceForm.horas_km}
                    onChange={(e) =>
                      setServiceForm({ ...serviceForm, horas_km: e.target.value })
                    }
                    placeholder="Ej: 4.300 hs"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Intervención
                  </label>
                  <select
                    value={serviceForm.tipo_service}
                    onChange={(e) =>
                      setServiceForm({ ...serviceForm, tipo_service: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    <option value="Mantenimiento / Cambio de Repuesto">
                      Mantenimiento / Cambio de Repuesto
                    </option>
                    <option value="Service Preventivo (Aceite y Filtros)">
                      Service Preventivo (Aceite y Filtros)
                    </option>
                    <option value="Reparación en Taller">Reparación en Taller</option>
                    <option value="Control Mensual OK">Control Mensual OK</option>
                  </select>
                </div>

                {/* LISTA MULTI-ÍTEM DE TAREAS Y REPUESTOS DEL SERVICE */}
                <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-extrabold text-slate-900 uppercase">
                        🔧 Tareas, Repuestos y Trabajos Realizados
                      </span>
                      <p className="text-[10px] text-slate-500">
                        Cargá todos los ítems del service (aceite, filtros, engrase, repuestos cambiados).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setServiceForm({
                          ...serviceForm,
                          tareas_items: [
                            ...(serviceForm.tareas_items || []),
                            { detalle: '', repuesto: '', numero_parte: '', costo: '' },
                          ],
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Agregar Ítem</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {(serviceForm.tareas_items || []).map((it, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-white border border-slate-200 grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-5">
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            Tarea / Trabajo / Repuesto *
                          </label>
                          <input
                            type="text"
                            value={it.detalle}
                            onChange={(e) => {
                              const newItems = [...serviceForm.tareas_items];
                              newItems[idx] = { ...newItems[idx], detalle: e.target.value };
                              setServiceForm({ ...serviceForm, tareas_items: newItems });
                            }}
                            placeholder="Ej: Cambio aceite motor / Filtro gasoil..."
                            className="w-full px-2 py-1 rounded border border-slate-300 font-semibold text-xs"
                          />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            Marca / Tipo
                          </label>
                          <input
                            type="text"
                            value={it.repuesto}
                            onChange={(e) => {
                              const newItems = [...serviceForm.tareas_items];
                              newItems[idx] = { ...newItems[idx], repuesto: e.target.value };
                              setServiceForm({ ...serviceForm, tareas_items: newItems });
                            }}
                            placeholder="Ej: John Deere 15W40"
                            className="w-full px-2 py-1 rounded border border-slate-300 text-xs"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            N° Parte
                          </label>
                          <input
                            type="text"
                            value={it.numero_parte}
                            onChange={(e) => {
                              const newItems = [...serviceForm.tareas_items];
                              newItems[idx] = { ...newItems[idx], numero_parte: e.target.value };
                              setServiceForm({ ...serviceForm, tareas_items: newItems });
                            }}
                            placeholder="Ej: RE504836"
                            className="w-full px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-1">
                          <div className="flex-1">
                            <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                              Costo ({serviceForm.moneda_carga})
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={it.costo}
                              onChange={(e) => {
                                const newItems = [...serviceForm.tareas_items];
                                newItems[idx] = { ...newItems[idx], costo: e.target.value };
                                const total = newItems.reduce((acc, x) => acc + (parseFloat(x.costo) || 0), 0);
                                setServiceForm({
                                  ...serviceForm,
                                  tareas_items: newItems,
                                  costo_input: total > 0 ? String(total) : serviceForm.costo_input,
                                });
                              }}
                              placeholder="0"
                              className="w-full px-2 py-1 rounded border border-slate-300 text-right font-bold text-xs"
                            />
                          </div>
                          {(serviceForm.tareas_items || []).length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = serviceForm.tareas_items.filter((_, i) => i !== idx);
                                setServiceForm({ ...serviceForm, tareas_items: newItems });
                              }}
                              className="p-1 rounded text-slate-400 hover:text-red-600 mt-3 cursor-pointer"
                              title="Quitar ítem"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Proveedor / Taller
                  </label>
                  <input
                    type="text"
                    value={serviceForm.proveedor_taller}
                    onChange={(e) =>
                      setServiceForm({
                        ...serviceForm,
                        proveedor_taller: e.target.value,
                      })
                    }
                    placeholder="Ej: Agroveterinaria / Taller Las Flores"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  />
                </div>

                {/* PROGRAMACIÓN DEL PRÓXIMO SERVICE */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      ⏰ Próximo Service (Horas / Km)
                    </label>
                    <input
                      type="text"
                      value={serviceForm.proximo_service_horas_km}
                      onChange={(e) =>
                        setServiceForm({ ...serviceForm, proximo_service_horas_km: e.target.value })
                      }
                      placeholder="Ej: 4.550 hs / +250 hs"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      📅 Fecha Estimada Próximo Service
                    </label>
                    <input
                      type="date"
                      value={serviceForm.proximo_service_fecha}
                      onChange={(e) =>
                        setServiceForm({ ...serviceForm, proximo_service_fecha: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                    />
                  </div>
                </div>

                {/* Bloque de Costo Opcional con impacto automático en gastos_campo */}
                <div className="sm:col-span-2 p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold text-emerald-950 uppercase">
                      Costo del Service / Repuesto (Opcional)
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-800">
                      Dólar Ref.: $ {Number(dolarRef || 1540).toLocaleString('es-AR')}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">
                        Moneda
                      </label>
                      <select
                        value={serviceForm.moneda_carga}
                        onChange={(e) =>
                          setServiceForm({
                            ...serviceForm,
                            moneda_carga: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                      >
                        <option value="ARS">$ ARS (Pesos)</option>
                        <option value="USD">US$ (Dólares)</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">
                        Importe ({serviceForm.moneda_carga})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={serviceForm.costo_input}
                        onChange={(e) =>
                          setServiceForm({ ...serviceForm, costo_input: e.target.value })
                        }
                        placeholder="0 (dejar vacío si fue control sin gasto)"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] font-semibold text-emerald-950 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={serviceForm.impactar_gastos}
                      onChange={(e) =>
                        setServiceForm({
                          ...serviceForm,
                          impactar_gastos: e.target.checked,
                        })
                      }
                      className="rounded border-emerald-400 text-emerald-700"
                    />
                    Impactar automáticamente en Costos & Finanzas (Rubro: Infraestructura / Proveedores Externos)
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Observaciones / Detalle del trabajo
                  </label>
                  <input
                    type="text"
                    value={serviceForm.observaciones}
                    onChange={(e) =>
                      setServiceForm({ ...serviceForm, observaciones: e.target.value })
                    }
                    placeholder="Notas del service o próximo control..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setServiceModalMaq(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  Guardar Service
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PARA CREAR NUEVO EQUIPO */}
      {showNewMaqModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-base font-extrabold">+ Incorporar Nuevo Equipo al Taller</h3>
              <button
                type="button"
                onClick={() => setShowNewMaqModal(false)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateMaquinaria} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Categoría
                  </label>
                  <select
                    value={newMaqForm.categoria}
                    onChange={(e) =>
                      setNewMaqForm({ ...newMaqForm, categoria: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                  >
                    {CATEGORIAS_MAQUINARIA.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Nombre / Marca y Modelo
                  </label>
                  <input
                    type="text"
                    value={newMaqForm.nombre}
                    onChange={(e) =>
                      setNewMaqForm({ ...newMaqForm, nombre: e.target.value })
                    }
                    placeholder="Ej: Fertilizadora — Yomel"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Horas / Km actuales
                  </label>
                  <input
                    type="text"
                    value={newMaqForm.horas_km_actuales}
                    onChange={(e) =>
                      setNewMaqForm({
                        ...newMaqForm,
                        horas_km_actuales: e.target.value,
                      })
                    }
                    placeholder="Ej: 1.200 hs"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Estado
                  </label>
                  <select
                    value={newMaqForm.estado}
                    onChange={(e) =>
                      setNewMaqForm({ ...newMaqForm, estado: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold"
                  >
                    {ESTADOS_MAQUINARIA.map((est) => (
                      <option key={est} value={est}>
                        {est}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewMaqModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 font-bold text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
                >
                  Crear Ficha de Máquina
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Gemini IA para Repuestos y Services */}
      {showGeminiRepuestoModal && (
        <GeminiRepuestoModal
          isOpen={true}
          onClose={() => setShowGeminiRepuestoModal(false)}
          maquinaria={maquinaria}
          fechaOperacion={fechaOperacion}
          dolarRef={dolarRef}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  );
}
