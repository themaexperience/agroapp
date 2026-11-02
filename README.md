# Stock de hacienda — libro de movimientos

App personal (PWA, funciona sin internet) para llevar el stock de un campo de cría de modo que cierre.
El stock nunca se escribe a mano: se calcula como suma de movimientos. Los conteos físicos se comparan contra lo calculado y cada diferencia queda en rojo hasta que se explica con motivo.

- `app/` — la app (HTML + JS sin build, sin dependencias externas en tiempo de uso).
- `tests/` — pruebas de la lógica: `node --test tests/*.test.mjs`.
- `REQUISITOS.md` — el encargo y los criterios de "digno".

Los datos del campo no están en este repositorio: se cargan importando un backup privado desde la app.
