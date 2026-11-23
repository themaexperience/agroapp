import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardList,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Trash2,
  Wrench,
  Calendar,
  MapPin,
  RotateCcw,
  Filter,
  FileDown,
  Edit3,
  X,
  Save,
  Truck,
  BookOpen,
  Stethoscope,
  ArrowRightLeft,
  Camera,
  Upload,
  Check,
  AlertCircle,
  FileText,
  User,
  Sparkles,
  ChevronRight,
  Eye,
  Activity,
  Layers,
  Play,
  ChevronDown,
  ChevronUp,
  Percent,
  MessageSquare,
  History,
  Construction,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatFechaAR, buildGoogleCalendarUrl } from '../utils/dateHelper';
import { exportarHojaTareasPDF } from '../utils/pdfHelper';
import { transcribirHojaCuadernoVeterinarioIA } from '../lib/geminiService';
import { aplicarMovimientoRodeos } from '../utils/rodeoMovimientos';
import { calcRodeoCabezas } from '../utils/rodeoHelpers';
import { confirmAction } from './ConfirmDialog';

export const CATEGORIAS_TAREA = [
  'Aguadas',
  'Alambrados',
  'Hacienda',
  'Caminos',
  'Maquinaria',
  'Pasturas / Siembra',
  'General',
];

export const PRIORIDADES_TAREA = ['Urgente', 'Alta', 'Media', 'Baja'];

export function getPrioridadStyle(prioridad) {
  switch (prioridad) {
    case 'Urgente':
      return 'bg-red-100 text-red-900 border-red-300';
    case 'Alta':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    case 'Media':
      return 'bg-blue-100 text-blue-900 border-blue-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const LABORES_VETERINARIAS = [
  'Tacto Rectal',
  'Raspaje / Venéreas',
  'Tratamiento Clínico',
  'Plan Sanitario / Vacunación',
  'Sangrado / Serología',
  'Necropsia',
  'Cesárea / Parto Distócico',
  'Otro',
];

export default function TareasCampoView({
  tareas = [],
  potreros = [],
  rodeos = [],
  infraestructura = [],
  fechaOperacion,
  draftTarea,
  onClearDraftTarea,
  onSelectPotreroInMap,
  onOpenCuadrilla,
  onNavigate,
  navContext = null,
  onClearNavContext,
  onRefresh,
  notify,
}) {
  // Solapa principal del Cuaderno de Campo
  const [activeSolapa, setActiveSolapa] = useState('tareas'); // 'tareas' | 'veterinario' | 'movimientos'
  const [showTareasAcciones, setShowTareasAcciones] = useState(false);

  // ==========================================
  // ESTADO SOLAPA 1: TAREAS OPERATIVAS
  // ==========================================
  const [saving, setSaving] = useState(false);
  const [editingTarea, setEditingTarea] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterPrioridad, setFilterPrioridad] = useState('TODAS');
  const [filterHorizonte, setFilterHorizonte] = useState('TODAS'); // 'TODAS' | 'SEMANAL' | 'MENSUAL'
  const [filterEstado, setFilterEstado] = useState('PENDIENTES'); // 'PENDIENTES' | 'EN_CURSO' | 'COMPLETADAS' | 'TODAS'

  // Bitácora de Avances Inline
  const [activeAvanceFormId, setActiveAvanceFormId] = useState(null);
  const [savingAvance, setSavingAvance] = useState(false);
  const [expandedAvances, setExpandedAvances] = useState({});
  const [avanceDraft, setAvanceDraft] = useState({
    nota: '',
    autor: '',
    porcentaje: '',
  });

  // Deep-linking cruzado
  useEffect(() => {
    if (!navContext) return;
    if (navContext.action === 'nueva_tarea') {
      setActiveSolapa('tareas');
      setTimeout(() => {
        const inputEl = document.getElementById('input-titulo-nueva-tarea');
        if (inputEl) {
          inputEl.focus();
          inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
      onClearNavContext?.();
      return;
    }
    if (navContext.tareaId) {
      setActiveSolapa('tareas');
      const found = (tareas || []).find((t) => String(t.id) === String(navContext.tareaId));
      if (found) {
        setFilterEstado('TODAS');
        setFilterCategoria('TODAS');
        setFilterPrioridad('TODAS');
        setFilterHorizonte('TODAS');
        setEditingTarea(found);
        setTimeout(() => {
          const el = document.getElementById(`tarea-item-${found.id}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 250);
        onClearNavContext?.();
      }
    } else if (navContext.potreroNumero != null) {
      setActiveSolapa('tareas');
      setFilterEstado('TODAS');
      onClearNavContext?.();
    }
  }, [navContext, tareas, onClearNavContext]);

  const [form, setForm] = useState({
    titulo: '',
    categoria: 'Aguadas',
    potrero_numero: '',
    infraestructura_nombre: '',
    prioridad: 'Media',
    fecha_limite: '',
    responsable: '',
    observaciones: '',
  });

  // Si venimos desde un potrero o infraestructura con datos pre-cargados
  useEffect(() => {
    if (draftTarea) {
      setActiveSolapa('tareas');
      setForm((prev) => ({
        ...prev,
        titulo: draftTarea.titulo || prev.titulo,
        categoria: draftTarea.categoria || prev.categoria,
        potrero_numero:
          draftTarea.potrero_numero != null ? String(draftTarea.potrero_numero) : prev.potrero_numero,
        infraestructura_nombre:
          draftTarea.infraestructura_nombre || prev.infraestructura_nombre,
        prioridad: draftTarea.prioridad || 'Alta',
        observaciones: draftTarea.observaciones || prev.observaciones,
      }));
      if (onClearDraftTarea) onClearDraftTarea();
    }
  }, [draftTarea, onClearDraftTarea]);

  // Función helper para normalizar estado multi-día
  const getTareaEstado = (t) => {
    if (t.completada || t.estado === 'completada' || t.estado === 'Completada') return 'completada';
    if (t.estado === 'en_curso' || t.estado === 'En Curso') return 'en_curso';
    return 'pendiente';
  };

  // KPIs de Tareas
  const stats = useMemo(() => {
    const pendientes = tareas.filter((t) => getTareaEstado(t) === 'pendiente');
    const enCurso = tareas.filter((t) => getTareaEstado(t) === 'en_curso');
    const completadas = tareas.filter((t) => getTareaEstado(t) === 'completada');
    const urgentes = tareas.filter(
      (t) => getTareaEstado(t) !== 'completada' && (t.prioridad === 'Urgente' || t.prioridad === 'Alta')
    );
    const hoy = new Date().toISOString().slice(0, 10);
    const vencidas = tareas.filter(
      (t) => getTareaEstado(t) !== 'completada' && t.fecha_limite && t.fecha_limite <= hoy
    );

    return {
      pendientesCount: pendientes.length,
      enCursoCount: enCurso.length,
      completadasCount: completadas.length,
      urgentesCount: urgentes.length,
      vencidasCount: vencidas.length,
      totalCount: tareas.length,
    };
  }, [tareas]);

  // Filtrado de Tareas
  const tareasFiltradas = useMemo(() => {
    return tareas.filter((t) => {
      const est = getTareaEstado(t);
      if (filterEstado === 'PENDIENTES' && est !== 'pendiente') return false;
      if (filterEstado === 'EN_CURSO' && est !== 'en_curso') return false;
      if (filterEstado === 'COMPLETADAS' && est !== 'completada') return false;
      if (filterCategoria !== 'TODAS' && t.categoria !== filterCategoria) return false;
      if (filterPrioridad !== 'TODAS' && t.prioridad !== filterPrioridad) return false;

      if (filterHorizonte !== 'TODAS') {
        if (!t.fecha_limite) return false;
        const hoy = new Date();
        const fLim = new Date(t.fecha_limite);
        const diffDays = Math.ceil((fLim - hoy) / (1000 * 60 * 60 * 24));

        if (filterHorizonte === 'SEMANAL' && (diffDays < 0 || diffDays > 7)) return false;
        if (filterHorizonte === 'MENSUAL' && (diffDays < 0 || diffDays > 30)) return false;
      }
      return true;
    });
  }, [tareas, filterEstado, filterCategoria, filterPrioridad, filterHorizonte]);

  // Agregar Tarea
  async function handleAddTarea(e) {
    e.preventDefault();
    if (!form.titulo.trim()) {
      notify?.('Completá el título de la tarea', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        titulo: form.titulo.trim(),
        categoria: form.categoria,
        potrero_numero: form.potrero_numero ? parseInt(form.potrero_numero, 10) : null,
        infraestructura_nombre: form.infraestructura_nombre.trim() || null,
        prioridad: form.prioridad,
        fecha_limite: form.fecha_limite || null,
        responsable: form.responsable.trim() || null,
        observaciones: form.observaciones.trim() || null,
        estado: 'pendiente',
        completada: false,
        avances: [],
      };

      const { error } = await supabase.from('tareas_campo').insert(payload);
      if (error) throw error;

      notify?.('Tarea creada exitosamente.', 'success');
      setForm({
        titulo: '',
        categoria: 'Aguadas',
        potrero_numero: '',
        infraestructura_nombre: '',
        prioridad: 'Media',
        fecha_limite: '',
        responsable: '',
        observaciones: '',
      });
      await onRefresh?.();
    } catch (err) {
      console.error('Error creando tarea:', err);
      notify?.(`Error al crear la tarea: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  // Cambiar Estado Directo (Pendiente / En Curso / Completada)
  async function handleChangeEstado(t, nuevoEstado) {
    try {
      const isCompletada = nuevoEstado === 'completada';
      const fechaComp = isCompletada
        ? fechaOperacion || new Date().toISOString().slice(0, 10)
        : null;

      const { error } = await supabase
        .from('tareas_campo')
        .update({
          estado: nuevoEstado,
          completada: isCompletada,
          fecha_completada: fechaComp,
        })
        .eq('id', t.id);

      if (error) throw error;

      const msgs = {
        en_curso: `Tarea "${t.titulo}" marcada como 🚧 En Curso.`,
        completada: `Tarea "${t.titulo}" marcada como ✅ Realizada.`,
        pendiente: `Tarea "${t.titulo}" reactivada como ⏳ Pendiente.`,
      };
      notify?.(msgs[nuevoEstado] || 'Estado actualizado.', 'success');
      await onRefresh?.();
    } catch (err) {
      console.error('Error actualizando estado de tarea:', err);
      notify?.(`Error al actualizar estado: ${err.message}`, 'error');
    }
  }

  // Toggle rápido entre completada y pendiente
  async function handleToggleCompletada(t) {
    const est = getTareaEstado(t);
    const nuevo = est === 'completada' ? 'pendiente' : 'completada';
    await handleChangeEstado(t, nuevo);
  }

  // Registrar Avance Diario en la Bitácora
  async function handleSaveAvance(t) {
    if (!avanceDraft.nota.trim()) {
      notify?.('Escribí una nota describiendo el avance realizado.', 'error');
      return;
    }
    setSavingAvance(true);
    try {
      const fechaHoy = fechaOperacion || new Date().toISOString().slice(0, 10);
      const nuevoAvance = {
        id: Date.now(),
        fecha: fechaHoy,
        autor: avanceDraft.autor?.trim() || t.responsable || 'Personal de Campo',
        nota: avanceDraft.nota.trim(),
        porcentaje:
          avanceDraft.porcentaje !== ''
            ? Math.min(100, Math.max(0, Number(avanceDraft.porcentaje)))
            : null,
      };

      const avancesPrevios = Array.isArray(t.avances) ? t.avances : [];
      const nuevosAvances = [...avancesPrevios, nuevoAvance];

      // Al guardar avance en tarea 'pendiente', pasarla automáticamente a 'en_curso'
      const estActual = getTareaEstado(t);
      const nuevoEstado = estActual === 'pendiente' ? 'en_curso' : estActual;

      const { error } = await supabase
        .from('tareas_campo')
        .update({
          avances: nuevosAvances,
          estado: nuevoEstado,
          completada: false,
        })
        .eq('id', t.id);

      if (error) throw error;

      notify?.(
        `¡Avance registrado! La tarea quedó ${nuevoEstado === 'en_curso' ? 'En Curso' : 'actualizada'}.`,
        'success'
      );
      setActiveAvanceFormId(null);
      setAvanceDraft({ nota: '', autor: '', porcentaje: '' });
      setExpandedAvances((prev) => ({ ...prev, [t.id]: true }));
      await onRefresh?.();
    } catch (err) {
      console.error('Error guardando avance:', err);
      notify?.(`Error al registrar avance: ${err.message}`, 'error');
    } finally {
      setSavingAvance(false);
    }
  }

  // Eliminar Tarea
  async function handleDeleteTarea(t) {
    const ok = await confirmAction({
      title: `¿Eliminar tarea "${t.titulo}"?`,
      description: 'Esta labor operativa será removida permanentemente del cuaderno de campo.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('tareas_campo').delete().eq('id', t.id);
      if (error) throw error;
      notify?.('Tarea eliminada correctamente.');
      await onRefresh?.();
    } catch (err) {
      console.error('Error eliminando tarea:', err);
      notify?.(`Error al eliminar la tarea: ${err.message}`, 'error');
    }
  }

  // Guardar Edición de Tarea
  async function handleSaveEditTarea(e) {
    e.preventDefault();
    if (!editingTarea || !editingTarea.titulo?.trim()) {
      notify?.('El título de la tarea no puede estar vacío.', 'error');
      return;
    }
    setSavingEdit(true);
    try {
      const est = editingTarea.estado || (editingTarea.completada ? 'completada' : 'pendiente');
      const isComp = est === 'completada';
      const payload = {
        titulo: editingTarea.titulo.trim(),
        categoria: editingTarea.categoria,
        potrero_numero: editingTarea.potrero_numero
          ? parseInt(editingTarea.potrero_numero, 10)
          : null,
        infraestructura_nombre: editingTarea.infraestructura_nombre?.trim() || null,
        prioridad: editingTarea.prioridad,
        fecha_limite: editingTarea.fecha_limite || null,
        responsable: editingTarea.responsable?.trim() || null,
        observaciones: editingTarea.observaciones?.trim() || null,
        estado: est,
        completada: isComp,
        fecha_completada: isComp
          ? editingTarea.fecha_completada || fechaOperacion || new Date().toISOString().slice(0, 10)
          : null,
      };

      const { error } = await supabase
        .from('tareas_campo')
        .update(payload)
        .eq('id', editingTarea.id);

      if (error) throw error;
      notify?.(`Tarea "${payload.titulo}" actualizada correctamente.`, 'success');
      setEditingTarea(null);
      await onRefresh?.();
    } catch (err) {
      console.error('Error actualizando tarea:', err);
      notify?.(`Error al actualizar la tarea: ${err.message}`, 'error');
    } finally {
      setSavingEdit(false);
    }
  }

  // ==========================================
  // ESTADO SOLAPA 2: CUADERNO VETERINARIO
  // ==========================================
  const [cuadernoVet, setCuadernoVet] = useState([]);
  const [loadingVet, setLoadingVet] = useState(false);
  const [showVetModal, setShowVetModal] = useState(false);
  const [scanningVetIA, setScanningVetIA] = useState(false);
  const [editingVetItem, setEditingVetItem] = useState(null);
  const [expandedVetTranscriptId, setExpandedVetTranscriptId] = useState(null);
  const [vetFilterRodeo, setFilterVetRodeo] = useState('TODOS');

  const [vetForm, setVetForm] = useState({
    fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
    veterinario: 'Dr. Veterinario',
    rodeo_id: '',
    rodeo_nombre: '',
    tipo_labor: 'Tacto Rectal',
    diagnostico: '',
    tratamiento_indicado: '',
    medicamentos_usados: '',
    recomendaciones: '',
    observaciones: '',
    transcripcion_ia: '',
  });

  const fetchCuadernoVet = async () => {
    setLoadingVet(true);
    try {
      const { data, error } = await supabase
        .from('cuaderno_veterinario')
        .select('*')
        .order('fecha', { ascending: false })
        .order('id', { ascending: false });
      if (error) throw error;
      setCuadernoVet(data || []);
    } catch (err) {
      console.error('Error cargando cuaderno_veterinario:', err);
    } finally {
      setLoadingVet(false);
    }
  };

  const handleOpenNewVet = () => {
    setEditingVetItem(null);
    setVetForm({
      fecha: fechaOperacion || new Date().toISOString().slice(0, 10),
      veterinario: 'Dr. Veterinario San José',
      rodeo_id: rodeos[0]?.id ? String(rodeos[0].id) : '',
      rodeo_nombre: rodeos[0]?.nombre || '',
      tipo_labor: 'Tacto Rectal',
      diagnostico: '',
      tratamiento_indicado: '',
      medicamentos_usados: '',
      recomendaciones: '',
      observaciones: '',
      transcripcion_ia: '',
    });
    setShowVetModal(true);
  };

  const handleOpenEditVet = (item) => {
    setEditingVetItem(item);
    setVetForm({
      fecha: item.fecha || '',
      veterinario: item.veterinario || '',
      rodeo_id: item.rodeo_id ? String(item.rodeo_id) : '',
      rodeo_nombre: item.rodeo_nombre || '',
      tipo_labor: item.tipo_labor || 'Tacto Rectal',
      diagnostico: item.diagnostico || '',
      tratamiento_indicado: item.tratamiento_indicado || '',
      medicamentos_usados: item.medicamentos_usados || '',
      recomendaciones: item.recomendaciones || '',
      observaciones: item.observaciones || '',
      transcripcion_ia: item.transcripcion_ia || '',
    });
    setShowVetModal(true);
  };

  const handleScanHojaVet = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanningVetIA(true);
    notify?.('Analizando foto de hoja de manga veterinaria con IA...', 'info');
    try {
      const res = await transcribirHojaCuadernoVeterinarioIA(file);
      if (res) {
        let matchedRodeoId = '';
        let matchedRodeoName = res.rodeo_nombre || '';
        if (res.rodeo_nombre && rodeos.length > 0) {
          const matched = rodeos.find((r) =>
            r.nombre.toLowerCase().includes(res.rodeo_nombre.toLowerCase())
          );
          if (matched) {
            matchedRodeoId = String(matched.id);
            matchedRodeoName = matched.nombre;
          }
        }

        setVetForm((prev) => ({
          ...prev,
          fecha: res.fecha || prev.fecha,
          veterinario: res.veterinario || prev.veterinario,
          rodeo_id: matchedRodeoId || prev.rodeo_id,
          rodeo_nombre: matchedRodeoName || prev.rodeo_nombre,
          tipo_labor: res.tipo_labor || prev.tipo_labor,
          diagnostico: res.diagnostico || prev.diagnostico,
          tratamiento_indicado: res.tratamiento_indicado || prev.tratamiento_indicado,
          medicamentos_usados: res.medicamentos_usados || prev.medicamentos_usados,
          recomendaciones: res.recomendaciones || prev.recomendaciones,
          transcripcion_ia: res.transcripcion_texto_completo || '',
        }));
        setActiveSolapa('veterinario');
        setShowVetModal(true);
        notify?.('¡Hoja manuscrita transcripta con éxito!', 'success');
      }
    } catch (err) {
      console.error('Error en escaneo IA:', err);
      notify?.(`Error al transcribir hoja: ${err.message}`, 'error');
    } finally {
      setScanningVetIA(false);
      e.target.value = '';
    }
  };

  const handleSaveVet = async (e) => {
    e.preventDefault();
    try {
      const rodeoObj = rodeos.find((r) => String(r.id) === String(vetForm.rodeo_id));
      const payload = {
        fecha: vetForm.fecha,
        veterinario: vetForm.veterinario?.trim() || 'Médico Veterinario',
        rodeo_id: rodeoObj?.id || null,
        rodeo_nombre: rodeoObj?.nombre || vetForm.rodeo_nombre?.trim() || null,
        tipo_labor: vetForm.tipo_labor,
        diagnostico: vetForm.diagnostico?.trim() || null,
        tratamiento_indicado: vetForm.tratamiento_indicado?.trim() || null,
        medicamentos_usados: vetForm.medicamentos_usados?.trim() || null,
        recomendaciones: vetForm.recomendaciones?.trim() || null,
        observaciones: vetForm.observaciones?.trim() || null,
        transcripcion_ia: vetForm.transcripcion_ia || null,
        updated_at: new Date().toISOString(),
      };

      if (editingVetItem) {
        const { error } = await supabase
          .from('cuaderno_veterinario')
          .update(payload)
          .eq('id', editingVetItem.id);
        if (error) throw error;
        notify?.('Entrada del Cuaderno Veterinario actualizada.', 'success');
      } else {
        const { error } = await supabase.from('cuaderno_veterinario').insert(payload);
        if (error) throw error;
        notify?.('Nueva indicación veterinaria guardada.', 'success');
      }
      setShowVetModal(false);
      setEditingVetItem(null);
      await fetchCuadernoVet();
    } catch (err) {
      notify?.(`Error al guardar en Cuaderno Veterinario: ${err.message}`, 'error');
    }
  };

  const handleDeleteVet = async (item) => {
    const ok = await confirmAction({
      title: `¿Eliminar entrada sanitaria del ${item.fecha}?`,
      description: `Labor: ${item.tipo_labor}. Se borrará el registro clínico del cuaderno veterinario de manga.`,
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('cuaderno_veterinario').delete().eq('id', item.id);
      if (error) throw error;
      notify?.('Registro veterinario eliminado.');
      await fetchCuadernoVet();
    } catch (err) {
      notify?.(`Error al eliminar: ${err.message}`, 'error');
    }
  };

  // ==========================================
  // HELPERS DE FORMATEO LIMPIO DE RODEOS Y POTREROS
  // ==========================================
  const formatPotreroLabel = (potreroNum) => {
    if (potreroNum === null || potreroNum === undefined || potreroNum === '') return 'Sin potrero asignado';
    const p = potreros.find((pot) => Number(pot.numero) === Number(potreroNum));
    return p ? `Pot. ${p.numero} - ${p.nombre}` : `Pot. ${potreroNum}`;
  };

  const formatRodeoOption = (rodeo) => {
    if (!rodeo) return '';
    const potLabel = formatPotreroLabel(rodeo.potrero_numero);
    const total = calcRodeoCabezas(rodeo);
    return `${rodeo.nombre} · ${potLabel} (${total} cab.)`;
  };

  // ==========================================
  // ESTADO SOLAPA 3: MOVIMIENTOS PACTADOS
  // ==========================================
  const [movimientosPactados, setMovimientosPactados] = useState([]);
  const [loadingMovs, setLoadingMovs] = useState(false);
  const [showMovModal, setShowMovModal] = useState(false);
  const [ejecutandoMovId, setEjecutandoMovId] = useState(null);
  const [movFilter, setMovFilter] = useState('PENDIENTES'); // 'PENDIENTES' | 'EJECUTADOS' | 'TODOS'

  const [movForm, setMovForm] = useState({
    fecha_pactada: fechaOperacion || new Date().toISOString().slice(0, 10),
    tipo_movimiento: 'Cambio de Potrero', // 'Cambio de Potrero' | 'Pase Parcial / Aparte' | 'Aparte a Rodeo Nuevo'
    rodeo_origen_id: '',
    rodeo_destino_id: '',
    potrero_origen: '',
    potrero_destino: '',
    nuevo_rodeo_nombre: '',
    nuevo_rodeo_rol: 'Plantel Cría',
    cantidades: {
      vacas: 0,
      terneros_machos: 0,
      terneros_hembras: 0,
      vaquillonas: 0,
      toros: 0,
    },
    ejecutar_inmediato: false,
    prioridad: 'Alta',
    responsable: 'Capataz de Campo',
    motivo: '',
  });

  const fetchMovimientosPactados = async () => {
    setLoadingMovs(true);
    try {
      const { data, error } = await supabase
        .from('movimientos_pactados')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMovimientosPactados(data || []);
    } catch (err) {
      console.error('Error cargando movimientos_pactados:', err);
    } finally {
      setLoadingMovs(false);
    }
  };

  useEffect(() => {
    fetchCuadernoVet();
    fetchMovimientosPactados();
  }, []);

  const handleOpenNewMov = () => {
    const firstRodeo = rodeos[0];
    const secondRodeo = rodeos[1] || rodeos[0];
    setMovForm({
      fecha_pactada: fechaOperacion || new Date().toISOString().slice(0, 10),
      tipo_movimiento: 'Cambio de Potrero',
      rodeo_origen_id: firstRodeo?.id ? String(firstRodeo.id) : '',
      rodeo_destino_id: secondRodeo?.id ? String(secondRodeo.id) : '',
      potrero_origen: firstRodeo?.potrero_numero != null ? String(firstRodeo.potrero_numero) : '',
      potrero_destino: '',
      nuevo_rodeo_nombre: '',
      nuevo_rodeo_rol: 'Plantel Cría',
      cantidades: {
        vacas: firstRodeo?.vacas || 0,
        terneros_machos: firstRodeo?.terneros_machos || 0,
        terneros_hembras: firstRodeo?.terneros_hembras || 0,
        vaquillonas: firstRodeo?.vaquillonas_reposicion || 0,
        toros: (firstRodeo?.toros_padres || 0) + (firstRodeo?.toritos || 0),
      },
      ejecutar_inmediato: false,
      prioridad: 'Alta',
      responsable: 'Capataz de Campo',
      motivo: '',
    });
    setShowMovModal(true);
  };

  // Lógica unificada de ejecución de movimientos (tanto en diferido como inmediata)
  const executeMovimientoLogic = async (mov) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const cants = mov.cantidades || {};

    // CASO 1: Aparte a Rodeo Nuevo (Destete / Lote Nuevo)
    if (mov.tipo_movimiento === 'Aparte a Rodeo Nuevo' || (!mov.rodeo_destino_id && mov.rodeo_destino_nombre)) {
      const orig = rodeos.find((r) => String(r.id) === String(mov.rodeo_origen_id));
      if (!orig) throw new Error('No se encontró el rodeo de origen para realizar el aparte.');

      const vVacas = Math.min(Math.max(0, parseInt(cants.vacas, 10) || 0), orig.vacas || 0);
      const vTM = Math.min(Math.max(0, parseInt(cants.terneros_machos, 10) || 0), orig.terneros_machos || 0);
      const vTH = Math.min(Math.max(0, parseInt(cants.terneros_hembras, 10) || 0), orig.terneros_hembras || 0);
      const vVaq = Math.min(Math.max(0, parseInt(cants.vaquillonas, 10) || 0), orig.vaquillonas_reposicion || 0);
      const vToros = Math.min(Math.max(0, parseInt(cants.toros, 10) || 0), (orig.toros_padres || 0) + (orig.toritos || 0));

      const totalApartadas = vVacas + vTM + vTH + vVaq + vToros;
      if (totalApartadas <= 0) {
        throw new Error('Debe especificar al menos 1 cabeza a apartar para crear el nuevo rodeo.');
      }

      // 1. Descontar del origen
      const origUpd = {
        vacas: Math.max(0, (orig.vacas || 0) - vVacas),
        terneros_machos: Math.max(0, (orig.terneros_machos || 0) - vTM),
        terneros_hembras: Math.max(0, (orig.terneros_hembras || 0) - vTH),
        terneros: Math.max(0, (orig.terneros || 0) - (vTM + vTH)),
        vaquillonas_reposicion: Math.max(0, (orig.vaquillonas_reposicion || 0) - vVaq),
        toros_padres: Math.max(0, (orig.toros_padres || 0) - vToros),
        fecha_actualizacion: hoy,
      };
      origUpd.total_cabezas = calcRodeoCabezas({ ...orig, ...origUpd });

      const { error: errOrig } = await supabase.from('rodeos').update(origUpd).eq('id', orig.id);
      if (errOrig) throw errOrig;

      // 2. Crear nuevo rodeo en Supabase
      const potNum = mov.potrero_destino ? parseInt(mov.potrero_destino, 10) : null;
      const nuevoNombre = mov.rodeo_destino_nombre?.trim() || `Apartado ${orig.nombre}`;
      const nuevoRol = cants.rol || mov.rol || 'Plantel Cría';

      const newRodeoPayload = {
        nombre: nuevoNombre,
        rol_protocolo: nuevoRol,
        potrero_numero: potNum,
        vacas: vVacas,
        terneros: vTM + vTH,
        terneros_machos: vTM,
        terneros_hembras: vTH,
        vaquillonas_reposicion: vVaq,
        toros_padres: vToros,
        toritos: 0,
        vacas_cut: 0,
        total_cabezas: totalApartadas,
        condicion_corporal: orig.condicion_corporal || 3.0,
        fecha_actualizacion: hoy,
        observaciones: `Apartado de "${orig.nombre}" el ${formatFechaAR(hoy)}.${mov.motivo ? ' ' + mov.motivo : ''}`.trim(),
        estado_observaciones: `Apartado de "${orig.nombre}" el ${formatFechaAR(hoy)}.${mov.motivo ? ' ' + mov.motivo : ''}`.trim(),
      };

      const { data: insertedRodeo, error: errIns } = await supabase
        .from('rodeos')
        .insert(newRodeoPayload)
        .select()
        .single();
      if (errIns) throw errIns;

      // 3. Si tiene potrero destino, marcar potrero en pastoreo
      if (potNum) {
        await supabase.from('potreros').update({ estado_semaforo: 'En pastoreo' }).eq('numero', potNum);
      }

      // 4. Registrar en movimientos_hacienda
      const logHacienda = {
        fecha: hoy,
        tipo_movimiento: 'Aparte / Destete',
        rodeo_id: orig.id,
        rodeo_nombre: `${orig.nombre} → ${nuevoNombre}`,
        potrero_origen: orig.potrero_numero,
        potrero_destino: potNum,
        categoria_afectada: 'Aparte a Rodeo Nuevo',
        cantidad_cabezas: totalApartadas,
        motivo_observaciones: `Aparte de ${totalApartadas} cab. de "${orig.nombre}" hacia nuevo rodeo "${nuevoNombre}".${mov.motivo ? ' Motivo: ' + mov.motivo : ''}`.trim(),
      };
      await supabase.from('movimientos_hacienda').insert(logHacienda);

      try {
        await supabase.from('movimientos_ganaderos').insert({
          fecha: hoy,
          tipo_movimiento: 'Aparte',
          rodeo: orig.nombre,
          rodeo_destino: nuevoNombre,
          potrero_origen: orig.potrero_numero,
          potrero_destino: potNum,
          cantidad: totalApartadas,
          detalle: logHacienda.motivo_observaciones,
        });
      } catch (_) {}

      // 5. Sincronizar en Modo Sandbox
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          if (Array.isArray(sData.rodeos)) {
            sData.rodeos = sData.rodeos.map((r) => {
              if (String(r.id) === String(orig.id)) {
                return { ...r, ...origUpd };
              }
              return r;
            });
            const newId = insertedRodeo?.id || (Date.now() % 1000000);
            sData.rodeos.push({
              id: newId,
              ...newRodeoPayload,
            });
          }
          if (Array.isArray(sData.movimientosHacienda)) {
            sData.movimientosHacienda.unshift({
              id: Date.now(),
              ...logHacienda,
            });
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'rodeos' } }));
        }
      } catch (sbErr) {
        console.warn('Aviso sincronizando sandbox:', sbErr);
      }
    }

    // CASO 2: Pase Parcial / Aparte entre rodeos existentes
    else if (mov.tipo_movimiento === 'Pase Parcial / Aparte' || (mov.rodeo_origen_id && mov.rodeo_destino_id)) {
      await aplicarMovimientoRodeos(supabase, {
        origenId: mov.rodeo_origen_id,
        destinoId: mov.rodeo_destino_id,
        cantidades: mov.cantidades || {},
        motivo: mov.motivo || `Orden de Movimiento #${mov.id || ''} ejecutada desde Cuaderno de Campo`,
      });

      // Sincronizar sandbox
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          const orig = sData.rodeos?.find((r) => String(r.id) === String(mov.rodeo_origen_id));
          const dest = sData.rodeos?.find((r) => String(r.id) === String(mov.rodeo_destino_id));
          if (orig && dest) {
            const vVacas = parseInt(cants.vacas, 10) || 0;
            const vTM = parseInt(cants.terneros_machos, 10) || 0;
            const vTH = parseInt(cants.terneros_hembras, 10) || 0;
            const vVaq = parseInt(cants.vaquillonas, 10) || 0;
            const vToros = parseInt(cants.toros, 10) || 0;

            orig.vacas = Math.max(0, (orig.vacas || 0) - vVacas);
            orig.terneros_machos = Math.max(0, (orig.terneros_machos || 0) - vTM);
            orig.terneros_hembras = Math.max(0, (orig.terneros_hembras || 0) - vTH);
            orig.terneros = Math.max(0, (orig.terneros || 0) - (vTM + vTH));
            orig.vaquillonas_reposicion = Math.max(0, (orig.vaquillonas_reposicion || 0) - vVaq);
            orig.toros_padres = Math.max(0, (orig.toros_padres || 0) - vToros);
            orig.total_cabezas = calcRodeoCabezas(orig);

            dest.vacas = (dest.vacas || 0) + vVacas;
            dest.terneros_machos = (dest.terneros_machos || 0) + vTM;
            dest.terneros_hembras = (dest.terneros_hembras || 0) + vTH;
            dest.terneros = (dest.terneros || 0) + (vTM + vTH);
            dest.vaquillonas_reposicion = (dest.vaquillonas_reposicion || 0) + vVaq;
            dest.toros_padres = (dest.toros_padres || 0) + vToros;
            dest.total_cabezas = calcRodeoCabezas(dest);

            localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
            window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'rodeos' } }));
          }
        }
      } catch (sbErr) {
        console.warn('Aviso sincronizando sandbox:', sbErr);
      }
    }

    // CASO 3: Cambio de Potrero (Rodeo Completo)
    else if (mov.rodeo_origen_id && mov.potrero_destino) {
      const orig = rodeos.find((r) => String(r.id) === String(mov.rodeo_origen_id));
      const potDest = parseInt(mov.potrero_destino, 10);

      const { error: errUpd } = await supabase
        .from('rodeos')
        .update({
          potrero_numero: potDest,
          fecha_actualizacion: hoy,
        })
        .eq('id', mov.rodeo_origen_id);
      if (errUpd) throw errUpd;

      // Actualizar semáforo potrero destino
      await supabase.from('potreros').update({ estado_semaforo: 'En pastoreo' }).eq('numero', potDest);

      const logHacienda = {
        fecha: hoy,
        tipo_movimiento: 'Traslado',
        rodeo_id: mov.rodeo_origen_id,
        rodeo_nombre: mov.rodeo_origen_nombre || orig?.nombre || 'Rodeo',
        potrero_origen: mov.potrero_origen || orig?.potrero_numero || null,
        potrero_destino: potDest,
        categoria_afectada: 'Cambio de Potrero Completo',
        cantidad_cabezas: mov.cantidad_cabezas || (orig ? calcRodeoCabezas(orig) : 0),
        motivo_observaciones: mov.motivo || `Cambio de potrero del rodeo completo "${orig?.nombre || ''}" hacia Pot. ${potDest}`,
      };
      await supabase.from('movimientos_hacienda').insert(logHacienda);

      // Sincronizar sandbox
      try {
        const raw = localStorage.getItem('san_jose_sandbox_data');
        if (raw) {
          const sData = JSON.parse(raw);
          const rObj = sData.rodeos?.find((r) => String(r.id) === String(mov.rodeo_origen_id));
          if (rObj) {
            rObj.potrero_numero = potDest;
            rObj.fecha_actualizacion = hoy;
          }
          if (Array.isArray(sData.movimientosHacienda)) {
            sData.movimientosHacienda.unshift({
              id: Date.now(),
              ...logHacienda,
            });
          }
          localStorage.setItem('san_jose_sandbox_data', JSON.stringify(sData));
          window.dispatchEvent(new CustomEvent('san_jose_sandbox_changed', { detail: { table: 'rodeos' } }));
        }
      } catch (sbErr) {
        console.warn('Aviso sincronizando sandbox:', sbErr);
      }
    }
  };

  const handleSaveMovimientoPactado = async (e) => {
    e.preventDefault();
    try {
      const orig = rodeos.find((r) => String(r.id) === String(movForm.rodeo_origen_id));
      if (!orig) {
        notify?.('Debe seleccionar un Rodeo de Origen.', 'error');
        return;
      }

      let destNombre = null;
      let destId = null;
      let potDest = null;

      if (movForm.tipo_movimiento === 'Cambio de Potrero') {
        if (!movForm.potrero_destino) {
          notify?.('Debe seleccionar el Potrero Destino para el traslado.', 'error');
          return;
        }
        potDest = parseInt(movForm.potrero_destino, 10);
        destNombre = `Potrero ${potDest}`;
      } else if (movForm.tipo_movimiento === 'Pase Parcial / Aparte') {
        const dest = rodeos.find((r) => String(r.id) === String(movForm.rodeo_destino_id));
        if (!dest) {
          notify?.('Debe seleccionar un Rodeo de Destino.', 'error');
          return;
        }
        destId = dest.id;
        destNombre = dest.nombre;
        potDest = dest.potrero_numero || null;
      } else if (movForm.tipo_movimiento === 'Aparte a Rodeo Nuevo') {
        if (!movForm.nuevo_rodeo_nombre?.trim()) {
          notify?.('Debe ingresar un Nombre para el Rodeo Nuevo a crear.', 'error');
          return;
        }
        if (!movForm.potrero_destino) {
          notify?.('Debe seleccionar el Potrero Destino donde pastará el nuevo rodeo.', 'error');
          return;
        }
        destNombre = movForm.nuevo_rodeo_nombre.trim();
        potDest = parseInt(movForm.potrero_destino, 10);
      }

      const cants = {
        vacas: parseInt(movForm.cantidades.vacas, 10) || 0,
        terneros_machos: parseInt(movForm.cantidades.terneros_machos, 10) || 0,
        terneros_hembras: parseInt(movForm.cantidades.terneros_hembras, 10) || 0,
        vaquillonas: parseInt(movForm.cantidades.vaquillonas, 10) || 0,
        toros: parseInt(movForm.cantidades.toros, 10) || 0,
        rol: movForm.nuevo_rodeo_rol || 'Plantel Cría',
      };
      const totalCab = cants.vacas + cants.terneros_machos + cants.terneros_hembras + cants.vaquillonas + cants.toros;

      if (totalCab <= 0) {
        notify?.('Debe especificar al menos 1 cabeza a trasladar.', 'error');
        return;
      }

      // Validar que no supere el stock disponible del origen
      if (cants.vacas > (orig.vacas || 0)) {
        notify?.(`Vacas: intenta trasladar ${cants.vacas} pero el origen solo tiene ${orig.vacas || 0}.`, 'error');
        return;
      }
      if (cants.terneros_machos > (orig.terneros_machos || 0)) {
        notify?.(`Terneros M: intenta trasladar ${cants.terneros_machos} pero el origen solo tiene ${orig.terneros_machos || 0}.`, 'error');
        return;
      }
      if (cants.terneros_hembras > (orig.terneros_hembras || 0)) {
        notify?.(`Terneros H: intenta trasladar ${cants.terneros_hembras} pero el origen solo tiene ${orig.terneros_hembras || 0}.`, 'error');
        return;
      }
      if (cants.vaquillonas > (orig.vaquillonas_reposicion || 0)) {
        notify?.(`Vaquillonas: intenta trasladar ${cants.vaquillonas} pero el origen solo tiene ${orig.vaquillonas_reposicion || 0}.`, 'error');
        return;
      }
      const torosDisp = (orig.toros_padres || 0) + (orig.toritos || 0);
      if (cants.toros > torosDisp) {
        notify?.(`Toros: intenta trasladar ${cants.toros} pero el origen solo tiene ${torosDisp}.`, 'error');
        return;
      }

      const payload = {
        fecha_pactada: movForm.fecha_pactada,
        tipo_movimiento: movForm.tipo_movimiento,
        rodeo_origen_id: orig.id,
        rodeo_origen_nombre: orig.nombre,
        rodeo_destino_id: destId,
        rodeo_destino_nombre: destNombre,
        potrero_origen: orig.potrero_numero || null,
        potrero_destino: potDest,
        cantidades: cants,
        cantidad_cabezas: totalCab,
        prioridad: movForm.prioridad,
        responsable: movForm.responsable?.trim() || null,
        motivo: movForm.motivo?.trim() || null,
        estado: movForm.ejecutar_inmediato ? 'Ejecutado' : 'Pendiente',
        fecha_ejecutado: movForm.ejecutar_inmediato ? new Date().toISOString() : null,
      };

      const { data: insertedMov, error: errInsert } = await supabase
        .from('movimientos_pactados')
        .insert(payload)
        .select()
        .single();
      if (errInsert) throw errInsert;

      if (movForm.ejecutar_inmediato) {
        await executeMovimientoLogic({
          ...payload,
          id: insertedMov?.id,
        });
        notify?.('Movimiento pactado y ejecutado inmediatamente en Rodeos.', 'success');
      } else {
        notify?.('Orden de movimiento pactada registrada en el Cuaderno.', 'success');
      }

      setShowMovModal(false);
      await fetchMovimientosPactados();
      await onRefresh?.();
    } catch (err) {
      console.error('Error al pactar movimiento:', err);
      notify?.(`Error al pactar movimiento: ${err.message}`, 'error');
    }
  };

  const handleEjecutarMovimiento = async (mov) => {
    const ok = await confirmAction({
      title: '¿Confirmar ejecución del movimiento pactado?',
      description: 'Se aplicará el traspaso de hacienda en Rodeos y se registrará en la Línea de Tiempo.',
      confirmText: 'Sí, ejecutar movimiento',
      variant: 'warning',
    });
    if (!ok) {
      return;
    }
    setEjecutandoMovId(mov.id);
    try {
      await executeMovimientoLogic(mov);

      const { error: errMov } = await supabase
        .from('movimientos_pactados')
        .update({
          estado: 'Ejecutado',
          fecha_ejecutado: new Date().toISOString(),
        })
        .eq('id', mov.id);
      if (errMov) throw errMov;

      notify?.(`Movimiento #${mov.id} ejecutado exitosamente en Rodeos.`, 'success');
      await fetchMovimientosPactados();
      await onRefresh?.();
    } catch (err) {
      console.error('Error al ejecutar movimiento:', err);
      notify?.(`Error al ejecutar movimiento: ${err.message}`, 'error');
    } finally {
      setEjecutandoMovId(null);
    }
  };

  const handleDeleteMovimiento = async (mov) => {
    const ok = await confirmAction({
      title: `¿Eliminar orden de movimiento #${mov.id}?`,
      description: 'La orden pactada será cancelada y removida del listado.',
      confirmText: 'Sí, eliminar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('movimientos_pactados').delete().eq('id', mov.id);
      if (error) throw error;
      notify?.('Orden de movimiento eliminada.');
      await fetchMovimientosPactados();
    } catch (err) {
      notify?.(`Error al eliminar orden: ${err.message}`, 'error');
    }
  };

  const movimientosFiltrados = useMemo(() => {
    return movimientosPactados.filter((m) => {
      if (movFilter === 'PENDIENTES') return m.estado === 'Pendiente';
      if (movFilter === 'EJECUTADOS') return m.estado === 'Ejecutado';
      return true;
    });
  }, [movimientosPactados, movFilter]);

  const cuadernoVetFiltrado = useMemo(() => {
    return cuadernoVet.filter((item) => {
      if (vetFilterRodeo === 'TODOS') return true;
      return String(item.rodeo_id) === String(vetFilterRodeo);
    });
  }, [cuadernoVet, vetFilterRodeo]);

  return (
    <div className="space-y-6">
      {/* ENCABEZADO PRINCIPAL DEL CUADERNO DE CAMPO */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-emerald-950 text-emerald-300 shadow-sm">
            <BookOpen className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>Cuaderno de Campo</span>
            </h1>
            <p className="text-xs text-slate-500 font-semibold mt-0.5">
              Establecimiento San José · Labores diarias, cuaderno sanitario de manga y órdenes de movimientos.
            </p>
          </div>
        </div>

        {/* Botonera Estandarizada: 3 Controles Limpios */}
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {/* Control 1: Botón Primario de Carga Manual */}
          <button
            type="button"
            onClick={() => {
              if (activeSolapa === 'veterinario') {
                handleOpenNewVet();
              } else {
                setActiveSolapa('tareas');
                setTimeout(() => {
                  const inputEl = document.getElementById('input-titulo-nueva-tarea');
                  if (inputEl) {
                    inputEl.focus();
                    inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 100);
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-[#14532d] hover:bg-[#0f3e21] text-white font-extrabold text-xs inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-emerald-300" />
            {activeSolapa === 'veterinario' ? '+ Nueva Entrada Sanitaria' : '+ Nueva Tarea'}
          </button>

          {/* Control 2: Botón Único de IA (Transcripción de Libreta de Manga / Notas con Gemini) */}
          <label className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 hover:from-slate-800 hover:to-emerald-900 text-white text-xs font-extrabold flex items-center gap-1.5 border border-emerald-500/40 shadow-sm transition active:scale-95 cursor-pointer shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>{scanningVetIA ? 'Transcribiendo con IA...' : '✨ Importar con IA'}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={handleScanHojaVet}
              disabled={scanningVetIA}
            />
          </label>

          {/* Control 3: Dropdown Compacto Acciones ▾ */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTareasAcciones((v) => !v)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
            >
              Acciones
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTareasAcciones ? 'rotate-180' : ''}`} />
            </button>

            {showTareasAcciones && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setShowTareasAcciones(false)}
                />
                <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTareasAcciones(false);
                      exportarHojaTareasPDF(tareasFiltradas, {
                        periodoLabel: `Hoja de Trabajo (${
                          filterHorizonte === 'SEMANAL'
                            ? 'Planificación Semanal'
                            : filterHorizonte === 'MENSUAL'
                            ? 'Planificación Mensual'
                            : 'Listado Operativo'
                        })`,
                        fechaOperacion,
                        notify,
                      });
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 font-semibold flex items-center gap-2"
                  >
                    <FileDown className="w-4 h-4 text-emerald-600" />
                    📄 Exportar Hoja de Tareas (PDF)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowTareasAcciones(false);
                      onOpenCuadrilla && onOpenCuadrilla();
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-amber-50 text-slate-700 hover:text-amber-900 font-semibold flex items-center gap-2"
                  >
                    <Truck className="w-4 h-4 text-amber-600" />
                    🛻 Armar Cuadrilla / Logística
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* SELECTOR DE 3 SOLAPAS OPERATIVAS (RESPONSIVE ENVOLVENTE EN MOBILE) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 md:inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 gap-1 w-full md:w-auto">
        <button
          type="button"
          onClick={() => setActiveSolapa('tareas')}
          className={`px-3 py-2 rounded-lg text-xs font-black flex items-center justify-center md:justify-start gap-1.5 transition cursor-pointer ${
            activeSolapa === 'tareas'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0" />
          <span className="truncate">Tareas & Recorridas</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
              activeSolapa === 'tareas' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {stats.pendientesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSolapa('veterinario')}
          className={`px-3 py-2 rounded-lg text-xs font-black flex items-center justify-center md:justify-start gap-1.5 transition cursor-pointer ${
            activeSolapa === 'veterinario'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Stethoscope className="w-4 h-4 shrink-0" />
          <span className="truncate">Cuaderno Veterinario</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
              activeSolapa === 'veterinario' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {cuadernoVet.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSolapa('movimientos')}
          className={`px-3 py-2 rounded-lg text-xs font-black flex items-center justify-center md:justify-start gap-1.5 transition cursor-pointer ${
            activeSolapa === 'movimientos'
              ? 'bg-emerald-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4 shrink-0" />
          <span className="truncate">Movimientos Pactados</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
              activeSolapa === 'movimientos' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {movimientosPactados.filter((m) => m.estado === 'Pendiente').length}
          </span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SOLAPA 1: TAREAS & RECORRIDAS DEL DÍA                                     */}
      {/* ========================================================================= */}
      {activeSolapa === 'tareas' && (
        <div className="space-y-6">
          {/* KPIs de Tareas de Campo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Tareas Pendientes
                </div>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {stats.pendientesCount}
                </div>
                <div className="text-xs text-slate-600 font-medium mt-1">Por iniciar en el campo</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-100 text-slate-700">
                <ClipboardList className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-blue-200 shadow-sm flex items-center justify-between bg-blue-50/30">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-blue-900 flex items-center gap-1">
                  <span>🚧 En Curso (Multi-Día)</span>
                </div>
                <div className="text-2xl font-black text-blue-900 mt-1">
                  {stats.enCursoCount}
                </div>
                <div className="text-xs text-blue-700 font-medium mt-1">Con avances y trabajos activos</div>
              </div>
              <div className="p-3 rounded-xl bg-blue-100 text-blue-800">
                <Construction className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Prioridad Urgente / Vencida
                </div>
                <div className="text-2xl font-extrabold text-amber-800 mt-1">
                  {stats.urgentesCount}
                </div>
                <div className="text-xs text-slate-600 font-medium mt-1">
                  {stats.vencidasCount > 0 ? `${stats.vencidasCount} con fecha vencida` : 'Atención prioritaria'}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-100 text-amber-800">
                <AlertTriangle className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  Tareas Completadas
                </div>
                <div className="text-2xl font-extrabold text-emerald-800 mt-1">
                  {stats.completadasCount}
                </div>
                <div className="text-xs text-slate-600 font-medium mt-1">Trabajos resueltos</div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Formulario para Crear Nueva Tarea de Campo */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-900/10 text-emerald-900 border border-emerald-200">
                  <Wrench className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Gestor de Tareas Operativas Semanal / Mensual
                  </h2>
                  <p className="text-xs text-slate-500">
                    Vinculá trabajos para el personal con Potrero/Ubicación, Responsable, Prioridad y
                    exportá la Hoja de Tareas en PDF con casillas [ ] para tildar a lapicera y firmar.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => onOpenCuadrilla && onOpenCuadrilla()}
                  className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
                  title="Planificar ruta óptima y checklist de camioneta para la cuadrilla"
                >
                  <Truck className="w-4 h-4 text-amber-200 shrink-0" />
                  <span>🛻 Armar Cuadrilla</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    exportarHojaTareasPDF(tareasFiltradas, {
                      periodoLabel: `Hoja de Trabajo (${
                        filterHorizonte === 'SEMANAL'
                          ? 'Planificación Semanal'
                          : filterHorizonte === 'MENSUAL'
                          ? 'Planificación Mensual'
                          : 'Listado Operativo'
                      })`,
                      fechaOperacion,
                      notify,
                    })
                  }
                  className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
                >
                  <FileDown className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>Exportar Hoja (PDF)</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleAddTarea} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-4">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Título de la Tarea *
                  </label>
                  <input
                    id="input-titulo-nueva-tarea"
                    type="text"
                    required
                    placeholder="Ej: Revisar flotante bebida o tensar alambre..."
                    value={form.titulo}
                    onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 font-semibold focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Categoría *
                  </label>
                  <select
                    value={form.categoria}
                    onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    {CATEGORIAS_TAREA.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Potrero Vinculado
                  </label>
                  <select
                    value={form.potrero_numero}
                    onChange={(e) => setForm({ ...form, potrero_numero: e.target.value })}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">General / Sin lote</option>
                    {potreros.map((p) => (
                      <option key={p.id} value={p.numero}>
                        Lote {p.numero} - {p.nombre} ({p.hectareas} ha)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Infraestructura
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Molino 4 / Bebedero..."
                    value={form.infraestructura_nombre}
                    onChange={(e) => setForm({ ...form, infraestructura_nombre: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Prioridad *
                  </label>
                  <select
                    value={form.prioridad}
                    onChange={(e) => setForm({ ...form, prioridad: e.target.value })}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    {PRIORIDADES_TAREA.map((pr) => (
                      <option key={pr} value={pr}>
                        {pr}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lg:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha Límite / Vencimiento
                  </label>
                  <input
                    type="date"
                    value={form.fecha_limite}
                    onChange={(e) => setForm({ ...form, fecha_limite: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  />
                </div>

                <div className="lg:col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Responsable Asignado
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Puestero Casco / Contratista..."
                    value={form.responsable}
                    onChange={(e) => setForm({ ...form, responsable: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div className="lg:col-span-6">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Instrucciones / Observaciones
                  </label>
                  <input
                    type="text"
                    placeholder="Herramientas necesarias, detalles de acceso, etc."
                    value={form.observaciones}
                    onChange={(e) => setForm({ ...form, observaciones: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-extrabold text-xs flex items-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>{saving ? 'Guardando...' : 'Cargar Tarea'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Filtros de Lista de Tareas */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filtrar:
              </span>

              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs font-bold flex-wrap">
                <button
                  type="button"
                  onClick={() => setFilterEstado('PENDIENTES')}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    filterEstado === 'PENDIENTES'
                      ? 'bg-white text-slate-900 shadow-2xs font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Pendientes ({stats.pendientesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEstado('EN_CURSO')}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer flex items-center gap-1 ${
                    filterEstado === 'EN_CURSO'
                      ? 'bg-blue-600 text-white shadow-2xs font-black'
                      : 'text-blue-900 hover:text-blue-950 hover:bg-blue-50'
                  }`}
                >
                  <span>🚧 En Curso</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                      filterEstado === 'EN_CURSO'
                        ? 'bg-blue-800 text-white'
                        : 'bg-blue-100 text-blue-900'
                    }`}
                  >
                    {stats.enCursoCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEstado('COMPLETADAS')}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    filterEstado === 'COMPLETADAS'
                      ? 'bg-emerald-700 text-white shadow-2xs font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ✅ Completadas ({stats.completadasCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEstado('TODAS')}
                  className={`px-2.5 py-1 rounded-md transition cursor-pointer ${
                    filterEstado === 'TODAS'
                      ? 'bg-white text-slate-900 shadow-2xs font-black'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todas ({tareas.length})
                </button>
              </div>

              <select
                value={filterHorizonte}
                onChange={(e) => setFilterHorizonte(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs bg-white font-semibold text-slate-700"
              >
                <option value="TODAS">📅 Todo el Horizonte</option>
                <option value="SEMANAL">🗓️ Próximos 7 días (Semanal)</option>
                <option value="MENSUAL">📆 Próximos 30 días (Mensual)</option>
              </select>

              <select
                value={filterCategoria}
                onChange={(e) => setFilterCategoria(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs bg-white font-semibold text-slate-700"
              >
                <option value="TODAS">Categoría: Todas</option>
                {CATEGORIAS_TAREA.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={filterPrioridad}
                onChange={(e) => setFilterPrioridad(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs bg-white font-semibold text-slate-700"
              >
                <option value="TODAS">Prioridad: Todas</option>
                {PRIORIDADES_TAREA.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-slate-500 font-semibold">
              Mostrando <strong className="text-slate-900">{tareasFiltradas.length}</strong> de{' '}
              {tareas.length} tareas
            </div>
          </div>

          {/* Listado de Tareas */}
          <div className="space-y-3">
            {tareasFiltradas.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/90 shadow-sm">
                <CheckCircle2 className="w-12 h-12 text-emerald-800/30 mx-auto mb-3" />
                <h3 className="text-base font-extrabold text-slate-900">
                  No hay tareas registradas con los filtros seleccionados
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Agregá una nueva tarea arriba o modificá los filtros de estado, prioridad o categoría.
                </p>
              </div>
            ) : (
              tareasFiltradas.map((t) => {
                const estado = getTareaEstado(t);
                const isPendiente = estado === 'pendiente';
                const isEnCurso = estado === 'en_curso';
                const isCompletada = estado === 'completada';

                const pStyle = getPrioridadStyle(t.prioridad);
                const potreroObj = potreros.find((p) => p.numero === t.potrero_numero);
                const hoy = new Date().toISOString().slice(0, 10);
                const esVencida = !isCompletada && t.fecha_limite && t.fecha_limite < hoy;
                const venceHoy = !isCompletada && t.fecha_limite === hoy;

                const avancesList = Array.isArray(t.avances) ? t.avances : [];
                const tieneAvances = avancesList.length > 0;
                const ultAvance = tieneAvances ? avancesList[avancesList.length - 1] : null;
                const isAvanceFormOpen = activeAvanceFormId === t.id;
                const isHistoryExpanded = Boolean(expandedAvances[t.id]);

                return (
                  <div
                    key={t.id}
                    id={`tarea-item-${t.id}`}
                    className={`bg-white rounded-2xl p-4 sm:p-5 border transition shadow-sm hover:shadow-md flex flex-col gap-3.5 ${
                      isCompletada
                        ? 'border-emerald-200 bg-emerald-50/20 opacity-85'
                        : isEnCurso
                        ? 'border-blue-300 bg-blue-50/15 ring-1 ring-blue-300/60 shadow-blue-50'
                        : esVencida
                        ? 'border-red-300 bg-red-50/20'
                        : 'border-slate-200/90'
                    }`}
                  >
                    {/* Fila Principal: Checkbox + Título + Badges + Controles */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Botón de Estado / Toggle */}
                        {isCompletada ? (
                          <button
                            type="button"
                            onClick={() => handleChangeEstado(t, 'pendiente')}
                            className="p-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 transition cursor-pointer mt-0.5 shadow-2xs"
                            title="Reabrir tarea como pendiente"
                          >
                            <CheckCircle2 className="w-5 h-5" />
                          </button>
                        ) : isEnCurso ? (
                          <button
                            type="button"
                            onClick={() => handleChangeEstado(t, 'completada')}
                            className="p-2 rounded-xl bg-blue-100 text-blue-800 hover:bg-emerald-600 hover:text-white transition cursor-pointer mt-0.5 border border-blue-300 shadow-2xs"
                            title="Completar tarea"
                          >
                            <Construction className="w-5 h-5 animate-pulse" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleChangeEstado(t, 'completada')}
                            className="p-2 rounded-xl bg-slate-100 text-slate-400 hover:text-emerald-800 hover:bg-emerald-50 border border-slate-300 transition cursor-pointer mt-0.5"
                            title="Marcar como realizada"
                          >
                            <Clock className="w-5 h-5" />
                          </button>
                        )}

                        <div className="min-w-0 space-y-1 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-sm font-extrabold ${
                                isCompletada ? 'line-through text-slate-400' : 'text-slate-900'
                              }`}
                            >
                              {t.titulo}
                            </span>

                            {/* Badge de Estado Multi-Día */}
                            {isEnCurso ? (
                              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-black bg-blue-100 text-blue-900 border border-blue-300 flex items-center gap-1 shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
                                <span>🚧 En Curso</span>
                              </span>
                            ) : isCompletada ? (
                              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
                                ✅ Completada
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                ⏳ Pendiente
                              </span>
                            )}

                            <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">
                              {t.categoria}
                            </span>

                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${pStyle}`}
                            >
                              {t.prioridad}
                            </span>

                            {esVencida && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-red-600 text-white animate-pulse">
                                Vencida
                              </span>
                            )}

                            {venceHoy && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-500 text-white">
                                Vence hoy
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                            {t.potrero_numero != null && (
                              <span className="flex items-center gap-1 font-semibold text-slate-700">
                                <MapPin className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                                Lote {t.potrero_numero}{' '}
                                {potreroObj ? `(${potreroObj.nombre})` : ''}
                              </span>
                            )}

                            {t.infraestructura_nombre && (
                              <span className="flex items-center gap-1 text-slate-600">
                                <Wrench className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                {t.infraestructura_nombre}
                              </span>
                            )}

                            {t.fecha_limite && (
                              <span
                                className={`flex items-center gap-1 font-semibold ${
                                  esVencida ? 'text-red-700' : venceHoy ? 'text-amber-700' : 'text-slate-600'
                                }`}
                              >
                                <Calendar className="w-3.5 h-3.5 shrink-0" />
                                {formatFechaAR(t.fecha_limite)}
                              </span>
                            )}

                            {t.responsable && (
                              <span className="text-slate-600">
                                Resp: <strong className="text-slate-800">{t.responsable}</strong>
                              </span>
                            )}
                          </div>

                          {t.observaciones && (
                            <p className="text-xs text-slate-600 italic pt-0.5">
                              {t.observaciones}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Botonera de Acciones y Cambio de Estado */}
                      <div className="flex items-center gap-1.5 flex-wrap self-end sm:self-center">
                        {isPendiente && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleChangeEstado(t, 'en_curso')}
                              className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-xs font-black flex items-center gap-1 transition cursor-pointer shadow-2xs"
                              title="Poner tarea en curso"
                            >
                              <Play className="w-3.5 h-3.5 fill-blue-700 text-blue-700" />
                              <span>Iniciar / En Curso</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveAvanceFormId(activeAvanceFormId === t.id ? null : t.id);
                                setAvanceDraft({ nota: '', autor: t.responsable || '', porcentaje: '' });
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                              title="Registrar avance de trabajo diario"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>+ Avance</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleChangeEstado(t, 'completada')}
                              className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-black flex items-center gap-1 transition cursor-pointer shadow-2xs"
                              title="Marcar completada"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Completar</span>
                            </button>
                          </>
                        )}

                        {isEnCurso && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveAvanceFormId(activeAvanceFormId === t.id ? null : t.id);
                                setAvanceDraft({ nota: '', autor: t.responsable || '', porcentaje: '' });
                              }}
                              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                              title="Agregar reporte o novedad de avance diario"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>+ Registrar Avance</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleChangeEstado(t, 'completada')}
                              className="px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1 transition cursor-pointer shadow-xs"
                              title="Marcar tarea resuelta"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Completar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleChangeEstado(t, 'pendiente')}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                              title="Pausar / volver a Pendiente"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}

                        {isCompletada && (
                          <button
                            type="button"
                            onClick={() => handleChangeEstado(t, 'pendiente')}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                            title="Reabrir tarea"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reabrir</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setEditingTarea(t)}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-emerald-900 hover:bg-emerald-50 transition cursor-pointer"
                          title="Editar tarea"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteTarea(t)}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                          title="Eliminar tarea"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Bitácora de Avances & Historial Cronológico */}
                    {tieneAvances && (
                      <div className="pt-2 border-t border-slate-100 space-y-2">
                        {/* Barra de progreso si el último avance tiene porcentaje */}
                        {ultAvance?.porcentaje != null && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] font-bold">
                              <span className="text-slate-500 flex items-center gap-1">
                                <Percent className="w-3 h-3 text-blue-600" /> Avance Estimado:
                              </span>
                              <span className="text-blue-900 font-black">{ultAvance.porcentaje}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, ultAvance.porcentaje))}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Recuadro del último avance registrado */}
                        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                          <div className="space-y-0.5 min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>Último avance ({ultAvance.fecha})</span>
                              {ultAvance.autor && (
                                <span className="text-slate-700 font-bold">· por {ultAvance.autor}</span>
                              )}
                              {ultAvance.porcentaje != null && (
                                <span className="px-1.5 py-0.2 rounded font-black text-[9.5px] bg-blue-100 text-blue-900">
                                  {ultAvance.porcentaje}%
                                </span>
                              )}
                            </div>
                            <p className="text-slate-800 font-medium truncate sm:whitespace-normal">
                              "{ultAvance.nota}"
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAvances((prev) => ({ ...prev, [t.id]: !prev[t.id] }))
                            }
                            className="text-[11px] font-black text-blue-700 hover:text-blue-900 flex items-center gap-0.5 shrink-0 hover:underline cursor-pointer"
                          >
                            <span>{isHistoryExpanded ? 'Ocultar' : `Historial (${avancesList.length})`}</span>
                            {isHistoryExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        {/* Despliegue completo del Historial Cronológico de Avances */}
                        {isHistoryExpanded && (
                          <div className="pl-3 border-l-2 border-blue-400 space-y-2 mt-2 pt-1">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                              📜 Historial Completo de Trabajos ({avancesList.length} registros)
                            </span>
                            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                              {avancesList.map((av, avIdx) => (
                                <div
                                  key={av.id || avIdx}
                                  className="text-xs bg-white p-2.5 rounded-xl border border-slate-200 space-y-0.5 shadow-2xs"
                                >
                                  <div className="flex items-center justify-between text-[10.5px]">
                                    <span className="font-mono font-bold text-slate-700">{formatFechaAR(av.fecha)}</span>
                                    <div className="flex items-center gap-1.5">
                                      {av.porcentaje != null && (
                                        <span className="px-1.5 py-0.2 rounded font-black text-[9.5px] bg-blue-100 text-blue-900">
                                          {av.porcentaje}%
                                        </span>
                                      )}
                                      <span className="text-slate-500 font-semibold">{av.autor || 'Personal'}</span>
                                    </div>
                                  </div>
                                  <p className="text-slate-800 font-medium">{av.nota}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Formulario Rápido Inline para Registrar Avance */}
                    {isAvanceFormOpen && (
                      <div className="pt-2 border-t border-blue-200 mt-1">
                        <div className="p-3.5 bg-blue-50/90 rounded-xl border border-blue-200 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-blue-950 flex items-center gap-1.5">
                              <Construction className="w-4 h-4 text-blue-700" />
                              Registrar Avance Diario de la Tarea
                            </span>
                            <button
                              type="button"
                              onClick={() => setActiveAvanceFormId(null)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div>
                            <label className="block text-[10.5px] font-bold uppercase text-slate-600 mb-1">
                              ¿Qué trabajo o avance se realizó hoy? *
                            </label>
                            <textarea
                              rows={2}
                              required
                              value={avanceDraft.nota}
                              onChange={(e) =>
                                setAvanceDraft({ ...avanceDraft, nota: e.target.value })
                              }
                              placeholder="Ej: Se colocaron 30 postes y se estiraron 2 hilos del alambrado..."
                              className="w-full px-3 py-1.5 rounded-lg border border-blue-300 text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600 font-medium"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10.5px] font-bold uppercase text-slate-600 mb-1">
                                Responsable / Personal (opcional)
                              </label>
                              <input
                                type="text"
                                value={avanceDraft.autor}
                                onChange={(e) =>
                                  setAvanceDraft({ ...avanceDraft, autor: e.target.value })
                                }
                                placeholder={t.responsable || 'Ej: Juan Pérez / Cuadrilla'}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-medium"
                              />
                            </div>
                            <div>
                              <label className="block text-[10.5px] font-bold uppercase text-slate-600 mb-1">
                                % de Avance Estimado (0-100%)
                              </label>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={avanceDraft.porcentaje}
                                onChange={(e) =>
                                  setAvanceDraft({ ...avanceDraft, porcentaje: e.target.value })
                                }
                                placeholder="Ej: 50"
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-bold"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setActiveAvanceFormId(null)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 hover:bg-white cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={savingAvance}
                              onClick={() => handleSaveAvance(t)}
                              className="px-3.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-black shadow-xs flex items-center gap-1.5 cursor-pointer"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>{savingAvance ? 'Guardando...' : 'Guardar Avance'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SOLAPA 2: CUADERNO VETERINARIO                                            */}
      {/* ========================================================================= */}
      {activeSolapa === 'veterinario' && (
        <div className="space-y-6">
          {/* Card de Cabecera con Botón de Alta y Escaneo IA */}
          <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-purple-100 text-purple-900 border border-purple-200">
                <Stethoscope className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Libreta Sanitaria de Manga & Diagnósticos
                </h2>
                <p className="text-xs text-slate-500 font-semibold">
                  Anotá las indicaciones clínicas, tactos, sangrados y recetas del veterinario o sacá una foto a la hoja manuscrita para transcribirla con IA.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Botón de Escaneo IA de Hoja de Libreta */}
              <label
                className={`px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer transition active:scale-95 ${
                  scanningVetIA ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>{scanningVetIA ? 'Transcribiendo con IA...' : '📷 Transcribir Foto de Hoja'}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={handleScanHojaVet}
                  disabled={scanningVetIA}
                />
              </label>

              <button
                type="button"
                onClick={handleOpenNewVet}
                className="px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Nueva Indicación Veterinaria</span>
              </button>
            </div>
          </div>

          {/* Filtro por Rodeo */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-bold text-slate-500">Filtrar por Rodeo:</span>
              <select
                value={vetFilterRodeo}
                onChange={(e) => setFilterVetRodeo(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-bold text-slate-800"
              >
                <option value="TODOS">Todos los Rodeos ({cuadernoVet.length})</option>
                {rodeos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatRodeoOption(r)}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-slate-500 font-semibold">
              Mostrando <strong className="text-slate-900">{cuadernoVetFiltrado.length}</strong> intervenciones
            </div>
          </div>

          {/* Listado de Indicaciones Veterinarias */}
          <div className="space-y-3">
            {cuadernoVetFiltrado.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/90 shadow-sm">
                <Stethoscope className="w-12 h-12 text-purple-300 mx-auto mb-3" />
                <h3 className="text-base font-extrabold text-slate-900">
                  No hay anotaciones veterinarias registradas
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Registrá una nueva indicación del veterinario o sacá una foto a la hoja manuscrita del cuaderno de manga.
                </p>
              </div>
            ) : (
              cuadernoVetFiltrado.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm hover:shadow-md transition space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-slate-900">
                          {formatFechaAR(item.fecha)}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-purple-100 text-purple-900 border border-purple-200">
                          {item.tipo_labor}
                        </span>
                        {item.rodeo_nombre && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200">
                            🐄 Rodeo: {item.rodeo_nombre}
                          </span>
                        )}
                        <span className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          Vet: <strong className="text-slate-700">{item.veterinario || 'Sin indicar'}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenEditVet(item)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-900 hover:bg-emerald-50 transition cursor-pointer"
                        title="Editar entrada veterinaria"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVet(item)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                        title="Eliminar entrada"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Cuerpo con Diagnóstico y Tratamiento */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    {item.diagnostico && (
                      <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                          Diagnóstico / Hallazgos
                        </span>
                        <p className="font-semibold text-slate-800 whitespace-pre-line">
                          {item.diagnostico}
                        </p>
                      </div>
                    )}

                    {item.tratamiento_indicado && (
                      <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-blue-900">
                          Tratamiento & Posología
                        </span>
                        <p className="font-semibold text-slate-800 whitespace-pre-line">
                          {item.tratamiento_indicado}
                        </p>
                        {item.medicamentos_usados && (
                          <p className="text-[11px] text-blue-950 font-bold pt-1">
                            💊 Medicamentos: {item.medicamentos_usados}
                          </p>
                        )}
                      </div>
                    )}

                    {item.recomendaciones && (
                      <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-900">
                          Recomendaciones para el Personal
                        </span>
                        <p className="font-semibold text-slate-800 whitespace-pre-line">
                          {item.recomendaciones}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Transcripción IA Desplegable si existe */}
                  {item.transcripcion_ia && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedVetTranscriptId(
                            expandedVetTranscriptId === item.id ? null : item.id
                          )
                        }
                        className="text-[11px] font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                        <span>
                          {expandedVetTranscriptId === item.id
                            ? 'Ocultar transcripción literal IA'
                            : 'Ver transcripción literal de la libreta de manga (IA)'}
                        </span>
                      </button>

                      {expandedVetTranscriptId === item.id && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] leading-relaxed border border-slate-800">
                          {item.transcripcion_ia}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SOLAPA 3: MOVIMIENTOS PACTADOS / ORDENADOS                                */}
      {/* ========================================================================= */}
      {activeSolapa === 'movimientos' && (
        <div className="space-y-6">
          {/* Card de Cabecera con Botón de Nueva Orden */}
          <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-amber-100 text-amber-900 border border-amber-200">
                <ArrowRightLeft className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Órdenes de Movimientos & Apartes de Hacienda
                </h2>
                <p className="text-xs text-slate-500 font-semibold">
                  Anotá movimientos futuros u ordenados para la gente del campo. Cuando se realicen, ejecutalos con 1 clic para impactar en Rodeos y en la Línea de Tiempo.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenNewMov}
              className="px-4 py-2.5 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Pactar Nuevo Movimiento</span>
            </button>
          </div>

          {/* Filtro por Estado */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-sm flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setMovFilter('PENDIENTES')}
                className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                  movFilter === 'PENDIENTES'
                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pendientes ({movimientosPactados.filter((m) => m.estado === 'Pendiente').length})
              </button>
              <button
                type="button"
                onClick={() => setMovFilter('EJECUTADOS')}
                className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                  movFilter === 'EJECUTADOS'
                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ejecutados ({movimientosPactados.filter((m) => m.estado === 'Ejecutado').length})
              </button>
              <button
                type="button"
                onClick={() => setMovFilter('TODOS')}
                className={`px-3 py-1.5 rounded-md transition cursor-pointer ${
                  movFilter === 'TODOS'
                    ? 'bg-white text-slate-900 shadow-2xs font-black'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos ({movimientosPactados.length})
              </button>
            </div>

            <div className="text-xs text-slate-500 font-semibold">
              Mostrando <strong className="text-slate-900">{movimientosFiltrados.length}</strong> órdenes
            </div>
          </div>

          {/* Listado de Movimientos Pactados */}
          <div className="space-y-3">
            {movimientosFiltrados.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-slate-200/90 shadow-sm">
                <ArrowRightLeft className="w-12 h-12 text-amber-300 mx-auto mb-3" />
                <h3 className="text-base font-extrabold text-slate-900">
                  No hay movimientos en este estado
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Pactá una nueva orden de movimiento arriba para organizar los cambios de potrero y apartes del campo.
                </p>
              </div>
            ) : (
              movimientosFiltrados.map((mov) => {
                const esPendiente = mov.estado === 'Pendiente';
                const cants = mov.cantidades || {};

                return (
                  <div
                    key={mov.id}
                    className={`bg-white rounded-2xl p-5 border transition shadow-sm hover:shadow-md space-y-3 ${
                      esPendiente
                        ? 'border-amber-300/80 bg-amber-50/10'
                        : 'border-emerald-200 bg-emerald-50/10 opacity-85'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-slate-400">
                          #{mov.id}
                        </span>
                        <span className="text-xs font-bold text-slate-600 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Previsto: {formatFechaAR(mov.fecha_pactada)}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-black bg-slate-100 text-slate-800 border border-slate-200">
                          {mov.tipo_movimiento}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${
                            esPendiente
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          }`}
                        >
                          {esPendiente ? '⏳ Pendiente' : '✅ Ejecutado en Rodeos'}
                        </span>
                        {mov.prioridad && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${getPrioridadStyle(
                              mov.prioridad
                            )}`}
                          >
                            {mov.prioridad}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {esPendiente && (
                          <button
                            type="button"
                            onClick={() => handleEjecutarMovimiento(mov)}
                            disabled={ejecutandoMovId === mov.id}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
                            title="Aplica el movimiento directamente en los Rodeos y en la Línea de Tiempo"
                          >
                            <Check className="w-4 h-4 text-emerald-300" />
                            <span>
                              {ejecutandoMovId === mov.id ? 'Ejecutando...' : '✅ Ejecutar en Rodeos'}
                            </span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteMovimiento(mov)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer"
                          title="Eliminar orden"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Trayectoria Visual Origen -> Destino */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <div className="font-extrabold text-slate-900">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Origen</span>
                          {mov.rodeo_origen_nombre || 'Rodeo Origen'}
                          {mov.potrero_origen != null && (
                            <span className="text-slate-500 font-semibold block text-[11px]">
                              📍 Lote {mov.potrero_origen}
                            </span>
                          )}
                        </div>

                        <ArrowRightLeft className="w-4 h-4 text-emerald-700" />

                        <div className="font-extrabold text-slate-900">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Destino</span>
                          {mov.tipo_movimiento === 'Aparte a Rodeo Nuevo' && (
                            <span className="inline-block px-1.5 py-0.5 mr-1.5 rounded bg-amber-100 text-amber-900 text-[10px] font-black uppercase tracking-wider border border-amber-300">
                              ★ Nuevo Rodeo
                            </span>
                          )}
                          <span>{mov.rodeo_destino_nombre || (mov.potrero_destino ? `Lote ${mov.potrero_destino}` : 'Destino')}</span>
                          {mov.potrero_destino != null && (
                            <span className="text-slate-500 font-semibold block text-[11px]">
                              📍 Lote {mov.potrero_destino}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Desglose de Cabezas */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-900 text-white font-black text-xs">
                          Total: {mov.cantidad_cabezas || 0} cab.
                        </span>
                        {cants.vacas > 0 && (
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px] font-bold">
                            Vacas: {cants.vacas}
                          </span>
                        )}
                        {(cants.terneros_machos > 0 || cants.terneros_hembras > 0) && (
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px] font-bold">
                            Terneros: {(Number(cants.terneros_machos) || 0) + (Number(cants.terneros_hembras) || 0)} (M:{cants.terneros_machos || 0}/H:{cants.terneros_hembras || 0})
                          </span>
                        )}
                        {cants.vaquillonas > 0 && (
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px] font-bold">
                            Vaq: {cants.vaquillonas}
                          </span>
                        )}
                        {cants.toros > 0 && (
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 text-[11px] font-bold">
                            Toros: {cants.toros}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Responsable e Instrucciones */}
                    <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
                      <div>
                        {mov.motivo && (
                          <p className="italic text-slate-700">
                            <strong>Instrucciones:</strong> {mov.motivo}
                          </p>
                        )}
                      </div>
                      {mov.responsable && (
                        <div className="text-[11px] font-semibold text-slate-500">
                          Asignado a: <strong className="text-slate-800">{mov.responsable}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REGISTRAR / EDITAR EN CUADERNO VETERINARIO                         */}
      {/* ========================================================================= */}
      {showVetModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="px-5 py-4 bg-purple-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-purple-300" />
                <h3 className="text-base font-extrabold">
                  {editingVetItem ? 'Editar Anotación Veterinaria' : 'Nueva Indicación Sanitaria en Manga'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowVetModal(false)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVet} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Fecha de la Intervención *
                  </label>
                  <input
                    type="date"
                    required
                    value={vetForm.fecha}
                    onChange={(e) => setVetForm({ ...vetForm, fecha: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Médico Veterinario *
                  </label>
                  <input
                    type="text"
                    required
                    value={vetForm.veterinario}
                    onChange={(e) => setVetForm({ ...vetForm, veterinario: e.target.value })}
                    placeholder="Ej: Dr. Martín Gómez"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Rodeo Vinculado
                  </label>
                  <select
                    value={vetForm.rodeo_id}
                    onChange={(e) => {
                      const r = rodeos.find((x) => String(x.id) === e.target.value);
                      setVetForm({
                        ...vetForm,
                        rodeo_id: e.target.value,
                        rodeo_nombre: r?.nombre || '',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    <option value="">Lote General / Sin rodeo específico</option>
                    {rodeos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {formatRodeoOption(r)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tipo de Labor Sanitaria *
                  </label>
                  <select
                    value={vetForm.tipo_labor}
                    onChange={(e) => setVetForm({ ...vetForm, tipo_labor: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold"
                  >
                    {LABORES_VETERINARIAS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Diagnóstico Clínico / Hallazgos en Manga
                  </label>
                  <textarea
                    rows={2}
                    value={vetForm.diagnostico}
                    onChange={(e) => setVetForm({ ...vetForm, diagnostico: e.target.value })}
                    placeholder="Ej: Tacto 92% preñez, 8 vacas vacías CUT. Cuadro de queratoconjuntivitis en 3 terneros..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Tratamiento Indicado & Medicamentos
                  </label>
                  <textarea
                    rows={2}
                    value={vetForm.tratamiento_indicado}
                    onChange={(e) => setVetForm({ ...vetForm, tratamiento_indicado: e.target.value })}
                    placeholder="Ej: Maxibiotic L.A. 20 ml por animal, repetir a las 72 hs si no remite..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Medicamentos Usados (Insumos)
                  </label>
                  <input
                    type="text"
                    value={vetForm.medicamentos_usados}
                    onChange={(e) => setVetForm({ ...vetForm, medicamentos_usados: e.target.value })}
                    placeholder="Ej: Maxibiotic L.A., Dexametasona"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Recomendaciones para el Personal
                  </label>
                  <input
                    type="text"
                    value={vetForm.recomendaciones}
                    onChange={(e) => setVetForm({ ...vetForm, recomendaciones: e.target.value })}
                    placeholder="Ej: Mantener en piquete sombra con agua limpia"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                {vetForm.fecha ? (
                  <a
                    href={buildGoogleCalendarUrl({
                      title: `San José · Vet: ${vetForm.tipo_labor || 'Intervención'} (${vetForm.rodeo_nombre || 'Rodeo'})`,
                      fecha: vetForm.fecha,
                      details: `Labor Veterinaria: ${vetForm.tipo_labor || ''}\nRodeo: ${vetForm.rodeo_nombre || ''}\nVeterinario: ${vetForm.veterinario || 'Médico Veterinario'}\nDiagnóstico: ${vetForm.diagnostico || ''}\nTratamiento: ${vetForm.tratamiento_indicado || ''}\nMedicamentos: ${vetForm.medicamentos_usados || ''}\nRecomendaciones: ${vetForm.recomendaciones || ''}\nEstablecimiento San José · Agroganadera Rincón del Sur S.A.`,
                      location: 'Establecimiento San José, Las Flores, Pcia. de Buenos Aires',
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 border border-purple-200 text-xs font-bold flex items-center gap-1.5 transition"
                    title="Agendar intervención en Google Calendar con recordatorio"
                  >
                    <span>📅 Agendar en mi Calendar</span>
                  </a>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowVetModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-purple-900 hover:bg-purple-800 text-white font-black flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Guardar en Cuaderno</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PACTAR NUEVO MOVIMIENTO DE HACIENDA                                */}
      {/* ========================================================================= */}
      {showMovModal && (() => {
        const selectedOrigenRodeo = rodeos.find((r) => String(r.id) === String(movForm.rodeo_origen_id));
        const selectedDestinoRodeo = rodeos.find((r) => String(r.id) === String(movForm.rodeo_destino_id));
        const maxVacas = selectedOrigenRodeo?.vacas || 0;
        const maxTM = selectedOrigenRodeo?.terneros_machos || 0;
        const maxTH = selectedOrigenRodeo?.terneros_hembras || 0;
        const maxVaq = selectedOrigenRodeo?.vaquillonas_reposicion || 0;
        const maxToros = (selectedOrigenRodeo?.toros_padres || 0) + (selectedOrigenRodeo?.toritos || 0);
        const totalTrasladar =
          (parseInt(movForm.cantidades.vacas, 10) || 0) +
          (parseInt(movForm.cantidades.terneros_machos, 10) || 0) +
          (parseInt(movForm.cantidades.terneros_hembras, 10) || 0) +
          (parseInt(movForm.cantidades.vaquillonas, 10) || 0) +
          (parseInt(movForm.cantidades.toros, 10) || 0);

        const handlePasarTodoStock = () => {
          if (!selectedOrigenRodeo) return;
          setMovForm((prev) => ({
            ...prev,
            cantidades: {
              ...prev.cantidades,
              vacas: maxVacas,
              terneros_machos: maxTM,
              terneros_hembras: maxTH,
              vaquillonas: maxVaq,
              toros: maxToros,
            },
          }));
        };

        const handleResetCantidades = () => {
          setMovForm((prev) => ({
            ...prev,
            cantidades: {
              ...prev.cantidades,
              vacas: 0,
              terneros_machos: 0,
              terneros_hembras: 0,
              vaquillonas: 0,
              toros: 0,
            },
          }));
        };

        const handleTipoMovimientoChange = (nuevoTipo) => {
          let updatedCantidades = { ...movForm.cantidades };
          if (nuevoTipo === 'Cambio de Potrero' && selectedOrigenRodeo) {
            updatedCantidades = {
              vacas: maxVacas,
              terneros_machos: maxTM,
              terneros_hembras: maxTH,
              vaquillonas: maxVaq,
              toros: maxToros,
            };
          }
          setMovForm((prev) => ({
            ...prev,
            tipo_movimiento: nuevoTipo,
            cantidades: updatedCantidades,
            nuevo_rodeo_nombre:
              nuevoTipo === 'Aparte a Rodeo Nuevo' && !prev.nuevo_rodeo_nombre
                ? `Destete ${selectedOrigenRodeo?.nombre || 'Lote'}`
                : prev.nuevo_rodeo_nombre,
          }));
        };

        const handleRodeoOrigenChange = (rodeoId) => {
          const orig = rodeos.find((x) => String(x.id) === String(rodeoId));
          const origPotrero = orig?.potrero_numero != null ? String(orig.potrero_numero) : '';
          let cants = { ...movForm.cantidades };

          if (movForm.tipo_movimiento === 'Cambio de Potrero' && orig) {
            cants = {
              vacas: orig.vacas || 0,
              terneros_machos: orig.terneros_machos || 0,
              terneros_hembras: orig.terneros_hembras || 0,
              vaquillonas: orig.vaquillonas_reposicion || 0,
              toros: (orig.toros_padres || 0) + (orig.toritos || 0),
            };
          } else if (orig) {
            // Ajustar topes si las cantidades anteriores superan el nuevo origen
            cants = {
              vacas: Math.min(parseInt(cants.vacas, 10) || 0, orig.vacas || 0),
              terneros_machos: Math.min(parseInt(cants.terneros_machos, 10) || 0, orig.terneros_machos || 0),
              terneros_hembras: Math.min(parseInt(cants.terneros_hembras, 10) || 0, orig.terneros_hembras || 0),
              vaquillonas: Math.min(parseInt(cants.vaquillonas, 10) || 0, orig.vaquillonas_reposicion || 0),
              toros: Math.min(parseInt(cants.toros, 10) || 0, (orig.toros_padres || 0) + (orig.toritos || 0)),
            };
          }

          setMovForm((prev) => ({
            ...prev,
            rodeo_origen_id: rodeoId,
            potrero_origen: origPotrero,
            cantidades: cants,
          }));
        };

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
              <div className="px-5 py-4 bg-emerald-950 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-emerald-300" />
                  <h3 className="text-base font-extrabold">Pactar Movimiento / Aparte de Hacienda</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMovModal(false)}
                  className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveMovimientoPactado} className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Fecha Prevista */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Fecha Prevista / Pactada *
                    </label>
                    <input
                      type="date"
                      required
                      value={movForm.fecha_pactada}
                      onChange={(e) => setMovForm({ ...movForm, fecha_pactada: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:border-emerald-600"
                    />
                  </div>

                  {/* Tipo de Movimiento (3 opciones) */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Tipo de Movimiento *
                    </label>
                    <select
                      value={movForm.tipo_movimiento}
                      onChange={(e) => handleTipoMovimientoChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                    >
                      <option value="Cambio de Potrero">Cambio de Potrero (rodeo completo)</option>
                      <option value="Pase Parcial / Aparte">Pase Parcial / Aparte a Rodeo Existente</option>
                      <option value="Aparte a Rodeo Nuevo">Aparte a Rodeo Nuevo (Destete / Lote Nuevo)</option>
                    </select>
                  </div>

                  {/* Rodeo Origen */}
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Rodeo Origen *
                    </label>
                    <select
                      required
                      value={movForm.rodeo_origen_id}
                      onChange={(e) => handleRodeoOrigenChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                    >
                      <option value="">Elegí rodeo origen...</option>
                      {rodeos.map((r) => (
                        <option key={r.id} value={r.id}>
                          {formatRodeoOption(r)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Tarjeta Informativa Compacta de Stock Disponible en Origen */}
                  {selectedOrigenRodeo && (
                    <div className="sm:col-span-2 p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs shadow-xs space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span className="flex items-center gap-1.5 text-emerald-950 font-black">
                          <Layers className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Stock Disponible en {selectedOrigenRodeo.nombre}:</span>
                        </span>
                        <span className="text-emerald-800 font-mono font-black text-xs">
                          {calcRodeoCabezas(selectedOrigenRodeo)} cabezas totales
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-semibold text-slate-800">
                          📍 {formatPotreroLabel(selectedOrigenRodeo.potrero_numero)}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="bg-white px-2 py-0.5 rounded border border-emerald-200">
                          <strong>{maxVacas}</strong> Vacas
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded border border-emerald-200">
                          <strong>{maxTM}</strong> Tern. M
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded border border-emerald-200">
                          <strong>{maxTH}</strong> Tern. H
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded border border-emerald-200">
                          <strong>{maxVaq}</strong> Vaq. Rep.
                        </span>
                        <span className="bg-white px-2 py-0.5 rounded border border-emerald-200">
                          <strong>{maxToros}</strong> Toros
                        </span>
                      </div>
                    </div>
                  )}

                  {/* OPCIÓN 1: CAMBIO DE POTRERO (RODEO COMPLETO) */}
                  {movForm.tipo_movimiento === 'Cambio de Potrero' && (
                    <>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Potrero Destino *
                        </label>
                        <select
                          required
                          value={movForm.potrero_destino}
                          onChange={(e) => setMovForm({ ...movForm, potrero_destino: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                        >
                          <option value="">Elegí potrero destino...</option>
                          {potreros.map((p) => (
                            <option key={p.id} value={p.numero}>
                              Pot. {p.numero} - {p.nombre} ({p.hectareas} ha)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2 p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-xs space-y-1 shadow-xs">
                        <div className="font-black text-sky-950 flex items-center gap-1.5">
                          <Check className="w-4 h-4 text-sky-700" />
                          <span>
                            Rodeo completo a trasladar: {selectedOrigenRodeo ? calcRodeoCabezas(selectedOrigenRodeo) : 0} cabezas
                          </span>
                        </div>
                        <p className="text-[11px] text-sky-800">
                          Se trasladará el 100% del rodeo <strong>{selectedOrigenRodeo?.nombre || 'seleccionado'}</strong> hacia el nuevo potrero automáticamente sin necesidad de tipear cada categoría manual.
                        </p>
                      </div>
                    </>
                  )}

                  {/* OPCIÓN 2: PASE PARCIAL / APARTE A RODEO EXISTENTE */}
                  {movForm.tipo_movimiento === 'Pase Parcial / Aparte' && (
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Rodeo Destino *
                      </label>
                      <select
                        required
                        value={movForm.rodeo_destino_id}
                        onChange={(e) => setMovForm({ ...movForm, rodeo_destino_id: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                      >
                        <option value="">Elegí rodeo destino...</option>
                        {rodeos
                          .filter((r) => String(r.id) !== String(movForm.rodeo_origen_id))
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {formatRodeoOption(r)}
                            </option>
                          ))}
                      </select>
                      {selectedDestinoRodeo && (
                        <p className="text-[11px] text-slate-600 mt-1.5 font-medium">
                          Destino actual: <strong>{selectedDestinoRodeo.nombre}</strong> en {formatPotreroLabel(selectedDestinoRodeo.potrero_numero)} · Stock actual: <strong>{calcRodeoCabezas(selectedDestinoRodeo)}</strong> cab.
                        </p>
                      )}
                    </div>
                  )}

                  {/* OPCIÓN 3: APARTE A RODEO NUEVO (DESTETE / LOTE NUEVO) */}
                  {movForm.tipo_movimiento === 'Aparte a Rodeo Nuevo' && (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Nombre del Rodeo Nuevo *
                        </label>
                        <input
                          type="text"
                          required
                          value={movForm.nuevo_rodeo_nombre}
                          onChange={(e) => setMovForm({ ...movForm, nuevo_rodeo_nombre: e.target.value })}
                          placeholder="Ej: Destete Noviembre 2026..."
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Rol del Rodeo *
                        </label>
                        <select
                          value={movForm.nuevo_rodeo_rol}
                          onChange={(e) => setMovForm({ ...movForm, nuevo_rodeo_rol: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                        >
                          <option value="Reposición">Reposición</option>
                          <option value="Plantel Cría">Plantel Cría</option>
                          <option value="Invernada / Recría">Invernada / Recría</option>
                          <option value="Descarte / CUT">Descarte / CUT</option>
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Potrero Destino del Nuevo Lote *
                        </label>
                        <select
                          required
                          value={movForm.potrero_destino}
                          onChange={(e) => setMovForm({ ...movForm, potrero_destino: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                        >
                          <option value="">Elegí potrero donde pastará el nuevo lote...</option>
                          {potreros.map((p) => (
                            <option key={p.id} value={p.numero}>
                              Pot. {p.numero} - {p.nombre} ({p.hectareas} ha)
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}

                  {/* GRILLA EDITABLE DE CABEZAS A TRASLADAR / APARTAR (Solo para Opciones 2 y 3) */}
                  {movForm.tipo_movimiento !== 'Cambio de Potrero' && (
                    <div className="sm:col-span-2 p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-black text-slate-900 uppercase block">
                            {movForm.tipo_movimiento === 'Aparte a Rodeo Nuevo'
                              ? 'Cabezas a Apartar para el Nuevo Rodeo'
                              : 'Cabezas a Trasladar al Rodeo Destino'}
                          </span>
                          <span className="text-[10.5px] text-slate-500">
                            No podés ingresar más cabezas que las disponibles en el origen.
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handlePasarTodoStock}
                            className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-white text-[11px] font-bold transition cursor-pointer"
                            title="Copia el 100% del stock disponible del rodeo origen"
                          >
                            ⇄ {movForm.tipo_movimiento === 'Aparte a Rodeo Nuevo' ? 'Apartar todo' : 'Pasar todo'}
                          </button>
                          <button
                            type="button"
                            onClick={handleResetCantidades}
                            className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-semibold transition cursor-pointer"
                          >
                            Limpiar
                          </button>
                          <span className="text-xs font-black text-emerald-900 bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-300">
                            Total: {totalTrasladar} cab.
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-5 gap-2">
                        {/* Vacas */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[10px] font-bold text-slate-700">Vacas</label>
                            <span className="text-[9px] font-mono text-slate-500">máx {maxVacas}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxVacas}
                            value={movForm.cantidades.vacas}
                            onChange={(e) => {
                              const val = Math.min(maxVacas, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setMovForm({
                                ...movForm,
                                cantidades: { ...movForm.cantidades, vacas: val },
                              });
                            }}
                            className="w-full px-2 py-1 rounded-lg border border-slate-300 text-center font-bold text-slate-900 bg-white"
                          />
                        </div>

                        {/* Terneros Machos */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[10px] font-bold text-slate-700">Tern. M</label>
                            <span className="text-[9px] font-mono text-slate-500">máx {maxTM}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxTM}
                            value={movForm.cantidades.terneros_machos}
                            onChange={(e) => {
                              const val = Math.min(maxTM, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setMovForm({
                                ...movForm,
                                cantidades: { ...movForm.cantidades, terneros_machos: val },
                              });
                            }}
                            className="w-full px-2 py-1 rounded-lg border border-slate-300 text-center font-bold text-slate-900 bg-white"
                          />
                        </div>

                        {/* Terneros Hembras */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[10px] font-bold text-slate-700">Tern. H</label>
                            <span className="text-[9px] font-mono text-slate-500">máx {maxTH}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxTH}
                            value={movForm.cantidades.terneros_hembras}
                            onChange={(e) => {
                              const val = Math.min(maxTH, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setMovForm({
                                ...movForm,
                                cantidades: { ...movForm.cantidades, terneros_hembras: val },
                              });
                            }}
                            className="w-full px-2 py-1 rounded-lg border border-slate-300 text-center font-bold text-slate-900 bg-white"
                          />
                        </div>

                        {/* Vaquillonas */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[10px] font-bold text-slate-700">Vaq.</label>
                            <span className="text-[9px] font-mono text-slate-500">máx {maxVaq}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxVaq}
                            value={movForm.cantidades.vaquillonas}
                            onChange={(e) => {
                              const val = Math.min(maxVaq, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setMovForm({
                                ...movForm,
                                cantidades: { ...movForm.cantidades, vaquillonas: val },
                              });
                            }}
                            className="w-full px-2 py-1 rounded-lg border border-slate-300 text-center font-bold text-slate-900 bg-white"
                          />
                        </div>

                        {/* Toros */}
                        <div>
                          <div className="flex items-center justify-between mb-0.5">
                            <label className="text-[10px] font-bold text-slate-700">Toros</label>
                            <span className="text-[9px] font-mono text-slate-500">máx {maxToros}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxToros}
                            value={movForm.cantidades.toros}
                            onChange={(e) => {
                              const val = Math.min(maxToros, Math.max(0, parseInt(e.target.value, 10) || 0));
                              setMovForm({
                                ...movForm,
                                cantidades: { ...movForm.cantidades, toros: val },
                              });
                            }}
                            className="w-full px-2 py-1 rounded-lg border border-slate-300 text-center font-bold text-slate-900 bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Responsable Asignado */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Responsable Asignado
                    </label>
                    <input
                      type="text"
                      value={movForm.responsable}
                      onChange={(e) => setMovForm({ ...movForm, responsable: e.target.value })}
                      placeholder="Ej: Capataz / Puestero..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                    />
                  </div>

                  {/* Prioridad */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Prioridad
                    </label>
                    <select
                      value={movForm.prioridad}
                      onChange={(e) => setMovForm({ ...movForm, prioridad: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                    >
                      <option value="Urgente">Urgente</option>
                      <option value="Alta">Alta</option>
                      <option value="Normal">Normal</option>
                    </select>
                  </div>

                  {/* Instrucciones / Motivo */}
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Instrucciones / Motivo
                    </label>
                    <input
                      type="text"
                      value={movForm.motivo}
                      onChange={(e) => setMovForm({ ...movForm, motivo: e.target.value })}
                      placeholder="Ej: Pasar a pastura limpia por terminación de ciclo de pastoreo o aparte para destete..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-900"
                    />
                  </div>

                  {/* Checkbox Ejecución Inmediata */}
                  <div className="sm:col-span-2 pt-1">
                    <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer hover:bg-emerald-50/50 transition">
                      <input
                        type="checkbox"
                        checked={movForm.ejecutar_inmediato}
                        onChange={(e) => setMovForm({ ...movForm, ejecutar_inmediato: e.target.checked })}
                        className="w-4 h-4 text-emerald-800 rounded border-slate-300 focus:ring-emerald-700 cursor-pointer"
                      />
                      <div className="text-xs">
                        <span className="font-black text-slate-900 block">
                          ⚡ Ejecutar movimiento inmediatamente en Rodeos
                        </span>
                        <span className="text-[11px] text-slate-600">
                          Aplica el traslado/aparte en el stock de rodeos y asienta el evento en la Línea de Tiempo ahora mismo.
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowMovModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-emerald-950 hover:bg-emerald-900 text-white font-black flex items-center gap-1.5 shadow-sm cursor-pointer transition active:scale-95"
                  >
                    <Save className="w-4 h-4 text-emerald-300" />
                    <span>{movForm.ejecutar_inmediato ? 'Pactar y Ejecutar Ahora' : 'Pactar Movimiento'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL EDITAR TAREA OPERATIVA (EXISTENTE)                                   */}
      {/* ========================================================================= */}
      {editingTarea &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-emerald-900" />
                  <h3 className="font-extrabold text-base text-slate-900">
                    Editar Tarea de Campo
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingTarea(null)}
                  className="p-1 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEditTarea} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Título de la Tarea *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingTarea.titulo || ''}
                    onChange={(e) =>
                      setEditingTarea({ ...editingTarea, titulo: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Categoría
                    </label>
                    <select
                      value={editingTarea.categoria || 'General'}
                      onChange={(e) =>
                        setEditingTarea({ ...editingTarea, categoria: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
                    >
                      {CATEGORIAS_TAREA.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Prioridad
                    </label>
                    <select
                      value={editingTarea.prioridad || 'Media'}
                      onChange={(e) =>
                        setEditingTarea({ ...editingTarea, prioridad: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-semibold"
                    >
                      {PRIORIDADES_TAREA.map((pr) => (
                        <option key={pr} value={pr}>
                          {pr}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Potrero Vinculado
                    </label>
                    <select
                      value={
                        editingTarea.potrero_numero != null
                          ? String(editingTarea.potrero_numero)
                          : ''
                      }
                      onChange={(e) =>
                        setEditingTarea({
                          ...editingTarea,
                          potrero_numero: e.target.value ? parseInt(e.target.value, 10) : null,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="">Sin potrero asignado</option>
                      {potreros.map((p) => (
                        <option key={p.id} value={p.numero}>
                          Lote {p.numero} - {p.nombre} ({p.hectareas} ha)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Infraestructura
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Molino 3 / Bebedero..."
                      value={editingTarea.infraestructura_nombre || ''}
                      onChange={(e) =>
                        setEditingTarea({
                          ...editingTarea,
                          infraestructura_nombre: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Fecha Límite
                    </label>
                    <input
                      type="date"
                      value={editingTarea.fecha_limite || ''}
                      onChange={(e) =>
                        setEditingTarea({ ...editingTarea, fecha_limite: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Responsable Asignado
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Puestero / Capataz..."
                      value={editingTarea.responsable || ''}
                      onChange={(e) =>
                        setEditingTarea({ ...editingTarea, responsable: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Estado Actual de la Tarea
                  </label>
                  <select
                    value={getTareaEstado(editingTarea)}
                    onChange={(e) =>
                      setEditingTarea({
                        ...editingTarea,
                        estado: e.target.value,
                        completada: e.target.value === 'completada',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-bold"
                  >
                    <option value="pendiente">⏳ Pendiente</option>
                    <option value="en_curso">🚧 En Curso (Multi-Día)</option>
                    <option value="completada">✅ Completada</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Descripción / Instrucciones de Campo y Justificación Técnica
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Instrucciones operativas detalladas, materiales o justificación técnica agronómica..."
                    value={editingTarea.observaciones || ''}
                    onChange={(e) =>
                      setEditingTarea({ ...editingTarea, observaciones: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  {editingTarea.fecha_limite ? (
                    <a
                      href={buildGoogleCalendarUrl({
                        title: `San José · ${editingTarea.titulo}`,
                        fecha: editingTarea.fecha_limite,
                        details: `Tarea: ${editingTarea.titulo}\nCategoría: ${editingTarea.categoria || 'General'}\nPrioridad: ${editingTarea.prioridad || 'Media'}\nPotrero: ${editingTarea.potrero_numero ? `Potrero ${editingTarea.potrero_numero}` : 'General'}\nResponsable: ${editingTarea.responsable || 'A designar'}\nInstrucciones: ${editingTarea.observaciones || ''}\nEstablecimiento San José · Agroganadera Rincón del Sur S.A.`,
                        location: 'Establecimiento San José, Las Flores, Pcia. de Buenos Aires',
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-bold flex items-center gap-1.5 transition"
                      title="Agendar en Google Calendar del celular o PC"
                    >
                      <span>📅 Agendar en mi Calendar</span>
                    </a>
                  ) : <div />}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingTarea(null)}
                      className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="px-4 py-2 rounded-xl bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50 cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingEdit ? 'Guardando...' : 'Guardar Cambios'}</span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
