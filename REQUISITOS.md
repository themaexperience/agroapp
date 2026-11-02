# REQUISITOS — pedido original del usuario (2026-11-01)

> Copia del encargo. Es la vara contra la que prueba el Verificador. No editar sin decisión registrada en LOG.md.

## Objetivo
App de uso personal para llevar el stock de hacienda de modo que CIERRE. La usa solo el dueño, que transcribe lo que los encargados marcan en papel.

## Problema central
El stock no coincide de una planilla a otra y no se sabe si hay errores de carga, enfermedad o faltantes. Hay que saber lo que hay y detectar cuando algo no cuadra.

## Principio de diseño (no negociable)
Libro de movimientos. El stock NUNCA se escribe a mano: se calcula como suma de movimientos.
- Cada hecho es un renglón: fecha, rodeo, categoría, cantidad, tipo (nacimiento, mortandad, venta, traslado entre rodeos, cambio de categoría, ingreso/compra), nota y N° de caravana opcional.
- El conteo físico es un registro aparte (fecha, rodeo, categoría, cantidad contada). La app muestra la diferencia contado − calculado y NO la tapa: queda marcada como "diferencia sin explicar" hasta que se cargue un ajuste con motivo.
- Nada se borra en silencio: anular o corregir un movimiento deja rastro.

## Alcance Fase 1
1. Rodeos y categorías editables, precargados.
2. Carga rápida de movimientos, botones grandes, mínimo tipeo.
3. Stock actual por rodeo, por categoría y total, calculado.
4. Carga de conteos y pantalla de diferencias.
5. Informe imprimible (PDF) del stock con fecha.
6. Historial mensual de stock.
7. Backup: exportar e importar todo (JSON y Excel).

Fuera de alcance (solo modelo de datos preparado): sanidad y calendario, siembras, caravanas por número, costos, ventas, EV, pesadas.

## Restricciones técnicas
- Mobile-first, instalable (PWA), 100% sin internet. Datos en el dispositivo. Sin backend ni cuentas.
- Aviso visible si hace más de 7 días que no se exporta un backup.
- Español rioplatense, números con punto de miles.
- Diseño: letra mín. 16 px, botones ≥ 48 px, filas altas, paleta #1B4332 #2D6A4F #52B788 #D8F3DC, Arial, celdas amarillas para completar.
- Prohibido: texto cortado con "…", desplegables donde alcanza con escribir, sliders, campos innecesarios, potreros específicos hardcodeados, precios en pantallas de campo.
- Datos no confirmados como parámetros editables (cantidad de vacas, fechas de parición, % de toros, potreros, qué cuenta como "vaca", qué es "Enfrente").

## Criterios de "digno"
1. Cargar un movimiento toma ≤ 5 toques y ≤ 15 segundos.
2. Stock = suma de movimientos: el orden de carga no lo altera, y anular un movimiento lo revierte exacto.
3. Cerrar y reabrir la app, incluso en modo avión, no pierde ningún dato.
4. Una diferencia de conteo aparece marcada en rojo y solo se limpia con un ajuste con motivo.
5. Si un movimiento dejaría un stock negativo, advierte antes de guardar.
6. Se ve y se usa bien en pantalla de 360 px de ancho.
7. Exportar un backup y reimportarlo en una instalación vacía reproduce exactamente el mismo stock.
8. El PDF sale con fecha y se lee bien impreso.
9. Con 20.000 movimientos cargados sigue siendo fluida.

## Entregables finales
La app, una guía de uso de una página, y una lista de lo que no se pudo verificar sin un celular real.
