'use strict';

let STATE = null;
let VIEW = 'movimientos';
let MOV_YEAR = 'all', MOV_MONTH = 'all'; // filtros de la vista Movimientos
let MES_YEAR = 'all', MES_MONTH = 'all'; // filtros de la vista Resúmenes por mes

const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const elFromHtml = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// Fecha de hoy en horario local (YYYY-MM-DD). No usar toISOString(): convierte
// a UTC y puede adelantar un día según la zona horaria.
const todayLocal = () => {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
};

// Suma de los egresos (gastosItems) de un registro de reserva/etc.
const egresosTotal = (rec) => Array.isArray(rec.gastosItems)
  ? rec.gastosItems.reduce((a, it) => a + (Number(it.monto) || 0), 0) : 0;

const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mesLabel(ym) {
  if (!ym || ym === 'sin-fecha') return 'Sin fecha';
  const [y, m] = ym.split('-');
  return `${MESES_NOMBRE[parseInt(m, 10) - 1] || ''} ${y}`;
}
function fechaLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
async function api(method, url, body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Error en la operación');
  }
  return res.json();
}

async function load() {
  STATE = await api('GET', '/api/state');
  render();
}

// ---------------------------------------------------------------------------
// Navegación
function setView(v) {
  VIEW = v;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('.app').classList.remove('nav-open'); // cierra el cajón en móvil al elegir vista
  render();
}

const TITLES = {
  general: 'Resumen anual',
  meses: 'Resúmenes por mes',
  movimientos: 'Movimientos',
  reserva: 'Reserva'
};

function render() {
  if (!STATE) return;
  const r = STATE.resumen;
  $('#ss-saldo').textContent = money(r.saldoActual);
  $('#ss-reserva').textContent = money(r.totalReserva);
  $('#view-title').textContent = TITLES[VIEW];

  const actions = $('#topbar-actions');
  actions.innerHTML = '';
  if (VIEW === 'movimientos') actions.appendChild(btn('+ Nuevo movimiento', 'primary', () => openMovModal()));
  if (VIEW === 'reserva') actions.appendChild(btn('+ Nuevo registro', 'primary', () => openReservaModal()));

  const root = $('#view-root');
  root.innerHTML = '';
  ({
    general: viewGeneral,
    meses: viewMeses,
    movimientos: viewMovimientos,
    reserva: viewReserva
  })[VIEW](root);
}

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + (cls || '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

// ---------------------------------------------------------------------------
// Vista: Resumen anual (ejecutivo, filtrado por año)
let GEN_YEAR = null; // año seleccionado en el resumen anual

function aniosDisponibles() {
  const set = new Set();
  STATE.rows.forEach((r) => { if (r.fecha) set.add(r.fecha.slice(0, 4)); });
  STATE.reserva.forEach((r) => { if (r.mes) set.add(r.mes.slice(0, 4)); });
  if (!set.size) set.add(String(new Date().getFullYear()));
  return [...set].sort();
}

function viewGeneral(root) {
  const years = aniosDisponibles();
  if (!GEN_YEAR || !years.includes(GEN_YEAR)) GEN_YEAR = years[years.length - 1];

  // Movimientos del año seleccionado
  const yearRows = STATE.rows.filter((x) => (x.fecha || '').startsWith(GEN_YEAR));
  const totalSeptimas = yearRows.reduce((a, x) => a + x.septima, 0);
  const totalGastos = yearRows.reduce((a, x) => a + x.gastos, 0);
  const saldoInicial = yearRows.length ? yearRows[0].saldoAnterior : STATE.resumen.saldoActual;
  const saldoFinal = yearRows.length ? yearRows[yearRows.length - 1].total : saldoInicial;

  // Fondos del año
  const totalReserva = STATE.reserva
    .filter((x) => (x.mes || '').startsWith(GEN_YEAR))
    .reduce((a, x) => a + (Number(x.monto) || 0), 0);

  // Selector de año
  const bar = document.createElement('div');
  bar.className = 'filterbar';
  bar.innerHTML = `
    <label>Año:
      <select id="gen-year">
        ${years.map((y) => `<option value="${y}"${y === GEN_YEAR ? ' selected' : ''}>${y}</option>`).join('')}
      </select>
    </label>
    <span class="muted">${yearRows.length} movimientos en ${GEN_YEAR}</span>`;
  root.appendChild(bar);

  const kpis = document.createElement('div');
  kpis.className = 'kpis';
  kpis.innerHTML = `
    <div class="kpi accent">
      <div class="label">Saldo al cierre de ${GEN_YEAR}</div>
      <div class="value">${money(saldoFinal)}</div>
      <div class="sub">Saldo inicial del año ${money(saldoInicial)}</div>
    </div>
    <div class="kpi">
      <div class="label">Séptimas del año (ingresos)</div>
      <div class="value pos">${money(totalSeptimas)}</div>
    </div>
    <div class="kpi">
      <div class="label">Gastos del año</div>
      <div class="value neg">${money(totalGastos)}</div>
    </div>
    <div class="kpi">
      <div class="label">Reserva del año</div>
      <div class="value">${money(totalReserva)}</div>
      <div class="sub">Fondo del saldo final mensual</div>
    </div>`;
  root.appendChild(kpis);

  // Gráfico mensual del año
  root.appendChild(monthlyBars(STATE.meses.filter((m) => (m.mes || '').startsWith(GEN_YEAR))));

  $('#gen-year').onchange = (e) => { GEN_YEAR = e.target.value; render(); };
}

function monthlyBars(meses) {
  const card = document.createElement('div');
  card.className = 'card';
  if (!meses.length) { card.innerHTML = '<div class="empty">Sin movimientos en este año.</div>'; return card; }
  const max = Math.max(...meses.map((m) => Math.max(m.ingresos, m.gastos)), 1);
  card.innerHTML = `<div class="card-head"><h2>Ingresos vs gastos por mes</h2></div>
    <div class="barlist">${meses.map((m) => `
      <div class="barrow">
        <div class="mlabel">${esc(mesLabel(m.mes))}</div>
        <div>
          <div class="bartrack" style="margin-bottom:4px"><div class="barfill in" style="width:${(m.ingresos / max * 100).toFixed(1)}%"></div></div>
          <div class="bartrack"><div class="barfill out" style="width:${(m.gastos / max * 100).toFixed(1)}%"></div></div>
        </div>
        <div class="barmeta">
          <div class="pos">${money(m.ingresos)}</div>
          <div class="neg">${money(m.gastos)}</div>
        </div>
      </div>`).join('')}
    </div>`;
  return card;
}

// ---------------------------------------------------------------------------
// Filtros reutilizables por Año y Mes
function aniosDe(fechas) {
  return [...new Set(fechas.filter(Boolean).map((f) => f.slice(0, 4)))].sort();
}

// Devuelve el HTML de dos selectores (Año y Mes) con el prefijo de id dado.
function yearMonthFilterHtml(idPrefix, years, selYear, selMonth) {
  const opt = (v, label, sel) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label}</option>`;
  return `<div class="filterbar">
    <label>Año:
      <select id="${idPrefix}-year">
        ${opt('all', 'Todos', selYear)}
        ${years.map((y) => opt(y, y, selYear)).join('')}
      </select>
    </label>
    <label>Mes:
      <select id="${idPrefix}-month">
        ${opt('all', 'Todos', selMonth)}
        ${MESES_NOMBRE.map((nm, i) => opt(String(i + 1).padStart(2, '0'), nm, selMonth)).join('')}
      </select>
    </label>
  </div>`;
}

// Texto descriptivo del filtro activo para los encabezados.
function filtroSufijo(year, month) {
  if (year === 'all' && month === 'all') return '(todos)';
  const partes = [];
  if (month !== 'all') partes.push(MESES_NOMBRE[parseInt(month, 10) - 1]);
  if (year !== 'all') partes.push(year);
  return '· ' + partes.join(' ');
}

// ¿La fecha (YYYY-MM-DD) o el mes (YYYY-MM) pasan el filtro?
function pasaFiltro(ymd, year, month) {
  const y = (ymd || '').slice(0, 4);
  const mo = (ymd || '').slice(5, 7);
  return (year === 'all' || y === year) && (month === 'all' || mo === month);
}

// ---------------------------------------------------------------------------
// Vista: Resúmenes por mes
function viewMeses(root) {
  const meses = STATE.meses;
  if (!meses.length) { root.innerHTML = '<div class="card"><div class="empty">Aún no hay movimientos.</div></div>'; return; }

  const years = aniosDe(meses.map((m) => m.mes));
  if (MES_YEAR !== 'all' && !years.includes(MES_YEAR)) MES_YEAR = 'all';
  const filtered = meses
    .filter((m) => pasaFiltro(m.mes, MES_YEAR, MES_MONTH))
    .sort((a, b) => (b.mes || '').localeCompare(a.mes || ''));

  root.appendChild(elFromHtml(yearMonthFilterHtml('mes', years, MES_YEAR, MES_MONTH)));

  // El reporte mensual sigue disponible en cada renglón. Esta tarjeta permite
  // generar el mismo tipo de corte para cualquier periodo de días.
  const rangeCard = document.createElement('div');
  rangeCard.className = 'card range-report';
  rangeCard.innerHTML = `
    <div class="card-head"><h2>Reporte por rango de fechas</h2></div>
    <div class="card-body">
      <form id="date-range-report" class="range-report-form">
        <label>Desde <input name="desde" type="date" required></label>
        <label>Hasta <input name="hasta" type="date" required></label>
        <button class="btn primary" type="submit">📄 Generar PDF</button>
      </form>
      <p class="muted range-report-help">Incluye los movimientos registrados entre ambas fechas, inclusive.</p>
    </div>`;
  root.appendChild(rangeCard);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h2>Resumen ejecutivo por mes ${filtroSufijo(MES_YEAR, MES_MONTH)}</h2></div>
    <div class="card-body">${filtered.length ? `
      <table class="tbl">
        <thead><tr>
          <th>Mes</th><th class="num">Movs.</th>
          <th class="num">Ingresos</th><th class="num">Gastos</th>
          <th class="num">Saldo fin de mes</th><th></th>
        </tr></thead>
        <tbody>
          ${filtered.map((m) => `<tr>
            <td><span class="lbl">Mes</span><b>${esc(mesLabel(m.mes))}</b></td>
            <td class="num"><span class="lbl">Movs.</span>${m.movimientos}</td>
            <td class="num pos"><span class="lbl">Ingresos</span>${money(m.ingresos)}</td>
            <td class="num neg"><span class="lbl">Gastos</span>${money(m.gastos)}</td>
            <td class="num"><span class="lbl">Saldo fin de mes</span><b>${money(m.saldoFinalMes)}</b></td>
            <td class="cell-actions"><button class="btn" data-pdf="${m.mes}">📄 PDF</button></td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty">Sin meses para el filtro seleccionado.</div>'}</div>`;
  root.appendChild(card);

  $('#mes-year').onchange = (e) => { MES_YEAR = e.target.value; render(); };
  $('#mes-month').onchange = (e) => { MES_MONTH = e.target.value; render(); };
  $('#date-range-report').onsubmit = (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    exportDateRangePdf(data.get('desde'), data.get('hasta'));
  };
}

// ---------------------------------------------------------------------------
// Vista: Movimientos
function viewMovimientos(root) {
  // Filtros por año y mes
  const years = aniosDe(STATE.rows.map((x) => x.fecha));
  if (MOV_YEAR !== 'all' && !years.includes(MOV_YEAR)) MOV_YEAR = 'all';
  const filtered = STATE.rows.filter((x) => pasaFiltro(x.fecha, MOV_YEAR, MOV_MONTH));

  root.appendChild(elFromHtml(yearMonthFilterHtml('mov', years, MOV_YEAR, MOV_MONTH)));

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h2>Movimientos ${filtroSufijo(MOV_YEAR, MOV_MONTH)}</h2></div>
    <div class="card-body">${tablaMovs(filtered, true)}</div>`;
  root.appendChild(card);

  $('#mov-year').onchange = (e) => { MOV_YEAR = e.target.value; render(); };
  $('#mov-month').onchange = (e) => { MOV_MONTH = e.target.value; render(); };
}

function comentarioGastos(r) {
  const parts = [];
  if (Array.isArray(r.gastosItems) && r.gastosItems.length) {
    parts.push(r.gastosItems.map((it) =>
      `<div class="g-line"><span>${esc(it.concepto) || '<span class="muted">Sin concepto</span>'}</span><b>${money(it.monto)}</b></div>`
    ).join(''));
  }
  if (r.comentario) parts.push(`<div class="nota-mov">📝 ${esc(r.comentario)}</div>`);
  return parts.length ? `<div class="gastos-desglose">${parts.join('')}</div>` : '<span class="muted">—</span>';
}

function tablaMovs(rows, withActions) {
  if (!rows.length) return '<div class="empty">Sin movimientos.</div>';
  return `<table class="tbl">
    <thead><tr>
      <th>Fecha</th><th class="num">Saldo ant.</th><th class="num">Séptima</th>
      <th class="num">Gastos</th><th class="num">Total</th><th>Comentarios</th>
      ${withActions ? '<th></th>' : ''}
    </tr></thead>
    <tbody>
      ${rows.slice().reverse().map((r) => `<tr>
        <td><span class="lbl">Fecha</span>${esc(fechaLabel(r.fecha))}</td>
        <td class="num muted"><span class="lbl">Saldo ant.</span>${money(r.saldoAnterior)}</td>
        <td class="num ${r.septima ? 'pos' : 'muted'}"><span class="lbl">Séptima</span>${r.septima ? money(r.septima) : '—'}</td>
        <td class="num ${r.gastos ? 'neg' : 'muted'}"><span class="lbl">Gastos</span>${r.gastos ? money(r.gastos) : '—'}</td>
        <td class="num"><span class="lbl">Total</span><b>${money(r.total)}</b></td>
        <td class="cell-wide"><span class="lbl">Comentarios</span>${comentarioGastos(r)}</td>
        ${withActions ? `<td class="cell-actions"><div class="row-actions">
          <button class="icon-btn" data-edit-mov="${r.id}">✏️</button>
          <button class="icon-btn" data-del-mov="${r.id}">🗑️</button>
        </div></td>` : ''}
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Vista: Reserva
function viewReserva(root) {
  const r = STATE.reserva;
  const total = STATE.resumen.totalReserva;
  const kpi = document.createElement('div');
  kpi.className = 'kpis';
  kpi.innerHTML = `<div class="kpi accent"><div class="label">Reserva acumulada</div><div class="value">${money(total)}</div>
    <div class="sub">Se desprende del saldo final de cada mes</div></div>`;
  root.appendChild(kpi);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h2>Registros de reserva</h2></div>
    <div class="card-body">${r.length ? `<table class="tbl">
      <thead><tr><th>Mes</th><th class="num">Reserva</th><th class="num">Egresos</th><th>Detalle</th><th></th></tr></thead>
      <tbody>${r.map((x) => { const eg = egresosTotal(x); return `<tr>
        <td><span class="lbl">Mes</span>${esc(x.mes ? mesLabel(x.mes) : '—')}</td>
        <td class="num ${x.monto ? 'pos' : 'muted'}"><span class="lbl">Reserva</span>${x.monto ? money(x.monto) : '—'}</td>
        <td class="num ${eg ? 'neg' : 'muted'}"><span class="lbl">Egresos</span>${eg ? money(eg) : '—'}</td>
        <td class="cell-wide"><span class="lbl">Detalle</span>${comentarioGastos(x)}</td>
        <td class="cell-actions"><div class="row-actions">
          <button class="icon-btn" data-edit-res="${x.id}">✏️</button>
          <button class="icon-btn" data-del-res="${x.id}">🗑️</button>
        </div></td>
      </tr>`; }).join('')}</tbody></table>` : '<div class="empty">Sin registros de reserva.</div>'}</div>`;
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Exportar reporte de tesorería mensual a PDF (vía impresión del navegador)
function exportDateRangePdf(desde, hasta) {
  if (!desde || !hasta || desde > hasta) {
    alert('Selecciona un rango de fechas válido.');
    return;
  }

  const rows = STATE.rows.filter((r) => r.fecha >= desde && r.fecha <= hasta);
  if (!rows.length) {
    alert('No hay movimientos registrados en el rango seleccionado.');
    return;
  }

  const ingresos = rows.reduce((a, r) => a + r.septima, 0);
  const gastos = rows.reduce((a, r) => a + r.gastos, 0);
  const ingresosRows = rows.filter((r) => r.septima > 0);
  const saldoInicial = rows[0].saldoAnterior;
  const saldoFinal = rows[rows.length - 1].total;
  const hoy = fechaLabel(todayLocal());
  const periodo = `${fechaLabel(desde)} al ${fechaLabel(hasta)}`;
  // La reserva se registra por mes, no por día. Para conservarla en el corte
  // se consideran los meses que abarca el rango elegido.
  const mesDesde = desde.slice(0, 7);
  const mesHasta = hasta.slice(0, 7);
  const reservaPeriodo = STATE.reserva.filter((r) => (r.mes || '') >= mesDesde && (r.mes || '') <= mesHasta);
  const reservaAnterior = STATE.reserva
    .filter((r) => (r.mes || '') < mesDesde)
    .reduce((a, r) => a + (Number(r.monto) || 0) - egresosTotal(r), 0);
  const reservaAportada = reservaPeriodo.reduce((a, r) => a + (Number(r.monto) || 0), 0);
  const reservaEgresos = reservaPeriodo.reduce((a, r) => a + egresosTotal(r), 0);
  const reservaTotal = reservaAnterior + reservaAportada - reservaEgresos;

  const gastoLineas = [];
  for (const r of rows) {
    if (Array.isArray(r.gastosItems) && r.gastosItems.length) {
      for (const it of r.gastosItems) {
        gastoLineas.push({ fecha: r.fecha, concepto: it.concepto || 'Sin concepto especificado', monto: Number(it.monto) || 0 });
      }
    } else if (r.gastos > 0) {
      gastoLineas.push({ fecha: r.fecha, concepto: r.comentario || 'Sin concepto especificado', monto: r.gastos });
    }
  }
  const desgloseGastos = gastoLineas.length
    ? gastoLineas.map((g) => `<tr><td>${esc(fechaLabel(g.fecha))}</td><td>${esc(g.concepto)}</td><td class="num">${money(g.monto)}</td></tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#666">Sin gastos en el periodo.</td></tr>';

  const comentarioEsGasto = (r) => !(Array.isArray(r.gastosItems) && r.gastosItems.length) && r.gastos > 0;
  const notas = rows.filter((r) => (r.comentario || '').trim() !== '' && !comentarioEsGasto(r));
  const seccionNotas = notas.length ? `<h2>Anotaciones del periodo</h2>
    <table><thead><tr><th>Fecha</th><th>Anotación</th></tr></thead><tbody>${notas.map((r) =>
      `<tr><td style="white-space:nowrap">${esc(fechaLabel(r.fecha))}</td><td>${esc(r.comentario)}</td></tr>`).join('')}
    </tbody></table>` : '';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte de Tesorería ${esc(periodo)} - Grupo Bill W</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 32px 38px; font-size: 13px; }
      .head { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #1d2a8a; padding-bottom: 16px; margin-bottom: 22px; }
      .head img { height: 88px; } .head h1 { font-size: 19px; margin: 0 0 4px; color: #1d2a8a; } .head .date { font-size: 12px; color: #555; }
      h2 { font-size: 14px; color: #1d2a8a; border-bottom: 1px solid #d4d8ec; padding-bottom: 5px; margin: 24px 0 10px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e4e6ef; }
      th { background: #eef0fb; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #333; } td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      .resumen td:first-child { color: #444; } .resumen td.num { font-weight: 700; } .total-row td { border-top: 2px solid #1d2a8a; font-weight: 800; font-size: 14px; }
      .pos { color: #15803d; } .neg { color: #b91c1c; } .firma { margin: 120px auto 0; width: 300px; text-align: center; } .firma .line { border-top: 1.5px solid #333; padding-top: 8px; }
      .firma .name { font-weight: 700; font-size: 14px; } .firma .role, .foot { color: #555; font-size: 12px; } .foot { margin-top: 40px; font-size: 10px; color: #999; text-align: center; }
      @media print { body { padding: 0; } @page { margin: 16mm; } }
    </style></head><body>
    <div class="head"><img src="logo.webp" alt="A.A."><div><h1>Reporte de Tesorería · Grupo Bill W</h1><div class="date">Periodo: ${esc(periodo)} · Generado el ${hoy}</div></div></div>
    <h2>Resumen del periodo</h2><table class="resumen"><tbody>
      <tr><td>Saldo inicial</td><td class="num">${money(saldoInicial)}</td></tr><tr><td>Ingresos (séptimas)</td><td class="num pos">${money(ingresos)}</td></tr>
      <tr><td>Gastos</td><td class="num neg">${money(gastos)}</td></tr><tr class="total-row"><td>Saldo final</td><td class="num">${money(saldoFinal)}</td></tr>
    </tbody></table>
    <h2>Ingresos del periodo</h2><table class="resumen"><tbody><tr><td>Número de sesiones con ingreso</td><td class="num">${ingresosRows.length}</td></tr>
      <tr><td>Promedio de ingreso por sesión</td><td class="num pos">${money(ingresosRows.length ? ingresos / ingresosRows.length : 0)}</td></tr><tr class="total-row"><td>Total ingresos</td><td class="num pos">${money(ingresos)}</td></tr></tbody></table>
    <h2>Desglose de gastos del periodo</h2><table><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Monto</th></tr></thead><tbody>${desgloseGastos}<tr class="total-row"><td colspan="2">Total gastos</td><td class="num neg">${money(gastos)}</td></tr></tbody></table>
    ${seccionNotas}
    <h2>Reserva</h2><table class="resumen"><tbody><tr><td>Saldo anterior a ${esc(mesLabel(mesDesde))}</td><td class="num">${money(reservaAnterior)}</td></tr>
      <tr><td>Reserva aportada en los meses del periodo</td><td class="num pos">${money(reservaAportada)}</td></tr>${reservaEgresos ? `<tr><td>Egresos de reserva en los meses del periodo</td><td class="num neg">${money(reservaEgresos)}</td></tr>` : ''}
      <tr class="total-row"><td>Reserva acumulada</td><td class="num">${money(reservaTotal)}</td></tr></tbody></table>
    <p style="font-size:11px;color:#666">La reserva se registra por mes; se incluyen los meses que abarca el rango seleccionado.</p>
    <div class="firma"><div class="line"><div class="name">Pablo B</div><div class="role">Tesorero de Grupo</div></div></div><div class="foot">Grupo Bill W · Alcohólicos Anónimos · Reporte de tesorería</div>
    <script>window.onload = function () { var img = document.images[0]; function go() { setTimeout(function () { window.focus(); window.print(); }, 150); } if (img && !img.complete) { img.onload = go; img.onerror = go; } else { go(); } };<\/script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para generar el PDF.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function exportMonthlyPdf(mes) {
  const m = STATE.meses.find((x) => x.mes === mes);
  if (!m) return;
  const rows = STATE.rows.filter((r) => r.mes === mes);
  const ingresosRows = rows.filter((r) => r.septima > 0);
  const hoy = fechaLabel(todayLocal());

  const reservaMes = STATE.reserva.filter((r) => r.mes === mes);
  const reservaAportadaMes = reservaMes.reduce((a, r) => a + (Number(r.monto) || 0), 0);
  const reservaEgresosMes = reservaMes.reduce((a, r) => a + egresosTotal(r), 0);
  const totalReservaMes = reservaAportadaMes - reservaEgresosMes;
  // Saldo anterior: reserva neta (aportaciones - egresos) de los meses previos.
  const reservaAnterior = STATE.reserva
    .filter((r) => (r.mes || '') < mes)
    .reduce((a, r) => a + (Number(r.monto) || 0) - egresosTotal(r), 0);
  const totalReserva = reservaAnterior + totalReservaMes;

  // Desglose de egresos de reserva del mes (solo si hay).
  const reservaEgresoLineas = [];
  for (const r of reservaMes) {
    if (Array.isArray(r.gastosItems)) {
      for (const it of r.gastosItems) {
        reservaEgresoLineas.push({ concepto: it.concepto || 'Egreso de reserva', monto: Number(it.monto) || 0 });
      }
    }
  }
  const reservaDesglose = reservaEgresoLineas.length
    ? `<table style="margin-top:10px"><thead><tr><th>Egresos reserva</th><th class="num">Monto</th></tr></thead><tbody>
        ${reservaEgresoLineas.map((g) => `<tr><td>${esc(g.concepto)}</td><td class="num neg">${money(g.monto)}</td></tr>`).join('')}
        <tr class="total-row"><td>Total egresos de reserva</td><td class="num neg">${money(reservaEgresosMes)}</td></tr>
      </tbody></table>`
    : '';

  // Cada concepto de gasto se lista como un renglón independiente.
  const gastoLineas = [];
  for (const r of rows) {
    if (Array.isArray(r.gastosItems) && r.gastosItems.length) {
      for (const it of r.gastosItems) {
        gastoLineas.push({ fecha: r.fecha, concepto: it.concepto || 'Sin concepto especificado', monto: Number(it.monto) || 0 });
      }
    } else if (r.gastos > 0) {
      gastoLineas.push({ fecha: r.fecha, concepto: r.comentario || 'Sin concepto especificado', monto: r.gastos });
    }
  }
  const desgloseGastos = gastoLineas.length
    ? gastoLineas.map((g) => `<tr>
        <td>${esc(fechaLabel(g.fecha))}</td>
        <td>${esc(g.concepto)}</td>
        <td class="num">${money(g.monto)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#666">Sin gastos en el mes.</td></tr>';

  // Anotaciones del mes (campo opcional capturado en cada movimiento).
  // En registros antiguos sin gastosItems, el comentario se usa como concepto
  // del gasto y ya sale en el desglose: en ese caso no es una anotación aparte.
  const comentarioEsGasto = (r) => !(Array.isArray(r.gastosItems) && r.gastosItems.length) && r.gastos > 0;
  const notas = rows.filter((r) => (r.comentario || '').trim() !== '' && !comentarioEsGasto(r));
  const seccionNotas = notas.length
    ? `<h2>Anotaciones del mes</h2>
    <table><thead><tr><th>Fecha</th><th>Anotación</th></tr></thead><tbody>
      ${notas.map((r) => `<tr>
        <td style="white-space:nowrap">${esc(fechaLabel(r.fecha))}</td>
        <td>${esc(r.comentario)}</td>
      </tr>`).join('')}
    </tbody></table>`
    : '';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte de Tesorería ${esc(mesLabel(mes))} - Grupo Bill W</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 32px 38px; font-size: 13px; }
      .head { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #1d2a8a; padding-bottom: 16px; margin-bottom: 22px; }
      .head img { height: 88px; }
      .head h1 { font-size: 19px; margin: 0 0 4px; color: #1d2a8a; }
      .head .date { font-size: 12px; color: #555; }
      h2 { font-size: 14px; color: #1d2a8a; border-bottom: 1px solid #d4d8ec; padding-bottom: 5px; margin: 24px 0 10px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e4e6ef; }
      th { background: #eef0fb; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #333; }
      td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
      .resumen td:first-child { color: #444; }
      .resumen td.num { font-weight: 700; }
      .total-row td { border-top: 2px solid #1d2a8a; font-weight: 800; font-size: 14px; }
      .pos { color: #15803d; } .neg { color: #b91c1c; }
      .firma { margin: 120px auto 0; width: 300px; text-align: center; }
      .firma .line { border-top: 1.5px solid #333; padding-top: 8px; }
      .firma .name { font-weight: 700; font-size: 14px; }
      .firma .role { color: #555; font-size: 12px; }
      .foot { margin-top: 40px; font-size: 10px; color: #999; text-align: center; }
      @media print { body { padding: 0; } @page { margin: 16mm; } }
    </style></head><body>
    <div class="head">
      <img src="logo.webp" alt="A.A.">
      <div>
        <h1>Reporte de Tesorería mes de ${esc(mesLabel(mes))} · Grupo Bill W</h1>
        <div class="date">Generado el ${hoy}</div>
      </div>
    </div>

    <h2>Resumen del mes</h2>
    <table class="resumen"><tbody>
      <tr><td>Saldo inicial del mes</td><td class="num">${money(m.saldoInicialMes)}</td></tr>
      <tr><td>Ingresos del mes (séptimas)</td><td class="num pos">${money(m.ingresos)}</td></tr>
      <tr><td>Gastos del mes</td><td class="num neg">${money(m.gastos)}</td></tr>
      <tr class="total-row"><td>Saldo final del mes</td><td class="num">${money(m.saldoFinalMes)}</td></tr>
    </tbody></table>

    <h2>Ingresos del mes</h2>
    <table class="resumen"><tbody>
      <tr><td>Número de sesiones</td><td class="num">${ingresosRows.length}</td></tr>
      <tr><td>Promedio de ingreso por sesión</td><td class="num pos">${money(ingresosRows.length ? m.ingresos / ingresosRows.length : 0)}</td></tr>
      <tr class="total-row"><td>Total ingresos</td><td class="num pos">${money(m.ingresos)}</td></tr>
    </tbody></table>

    <h2>Desglose de gastos del mes</h2>
    <table><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Monto</th></tr></thead><tbody>
      ${desgloseGastos}
      <tr class="total-row"><td colspan="2">Total gastos</td><td class="num neg">${money(m.gastos)}</td></tr>
    </tbody></table>

    ${seccionNotas}

    <h2>Reserva</h2>
    <table class="resumen"><tbody>
      <tr><td>Saldo anterior (meses anteriores)</td><td class="num">${money(reservaAnterior)}</td></tr>
      <tr><td>Reserva aportada en el mes</td><td class="num pos">${money(reservaAportadaMes)}</td></tr>
      ${reservaEgresosMes ? `<tr><td>Egresos de reserva en el mes</td><td class="num neg">${money(reservaEgresosMes)}</td></tr>` : ''}
      <tr class="total-row"><td>Reserva acumulada (total)</td><td class="num">${money(totalReserva)}</td></tr>
    </tbody></table>
    ${reservaDesglose}

    <div class="firma">
      <div class="line">
        <div class="name">Pablo B</div>
        <div class="role">Tesorero de Grupo</div>
      </div>
    </div>

    <div class="foot">Grupo Bill W · Alcohólicos Anónimos · Reporte de tesorería</div>
    <script>
      window.onload = function () {
        var img = document.images[0];
        function go() { setTimeout(function () { window.focus(); window.print(); }, 150); }
        if (img && !img.complete) { img.onload = go; img.onerror = go; } else { go(); }
      };
    <\/script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Permite las ventanas emergentes para generar el PDF.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ---------------------------------------------------------------------------
// Modales
function openModal(title, fieldsHtml, onSubmit, onReady) {
  $('#modal-title').textContent = title;
  $('#modal-form').innerHTML = fieldsHtml;
  $('#modal-backdrop').hidden = false;
  const form = $('#modal-form');
  if (onReady) onReady(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      STATE = await onSubmit(data, form);
      closeModal();
      render();
    } catch (err) { alert(err.message); }
  };
  const first = form.querySelector('input,select,textarea');
  if (first) first.focus();
}
function closeModal() { $('#modal-backdrop').hidden = true; $('#modal-form').onsubmit = null; }

function field(label, name, type, value, extra = '') {
  return `<label class="field"><span>${label}</span>
    <input name="${name}" type="${type}" value="${value != null ? esc(value) : ''}" ${extra} /></label>`;
}

function textareaField(label, name, value, placeholder = '') {
  return `<label class="field"><span>${label}</span>
    <textarea name="${name}" rows="2" placeholder="${esc(placeholder)}">${value != null ? esc(value) : ''}</textarea></label>`;
}

function gastoRowHtml(concepto = '', monto = '') {
  const m = (monto !== '' && monto != null) ? esc(monto) : '';
  return `<div class="gasto-row">
    <input class="g-concepto" type="text" placeholder="Concepto del gasto" value="${esc(concepto)}" />
    <input class="g-monto" type="number" step="0.01" min="0" placeholder="0.00" value="${m}" />
    <button type="button" class="icon-btn g-del" title="Quitar renglón">🗑️</button>
  </div>`;
}

// --- Sección reutilizable de gastos con varios conceptos (sin comentario) ---
function gastosFieldHtml(items, label) {
  const rows = (items && items.length) ? items : [{ concepto: '', monto: '' }];
  return `<div class="field">
    <span>${label}</span>
    <div id="gastos-list">${rows.map((it) => gastoRowHtml(it.concepto, it.monto)).join('')}</div>
    <button type="button" class="btn ghost" id="add-gasto" style="margin-top:4px">+ Agregar concepto de gasto</button>
    <div class="gasto-total muted" id="gasto-total" style="margin-top:8px"></div>
  </div>`;
}

function wireGastos(form) {
  const list = $('#gastos-list', form);
  const recalc = () => {
    const total = $$('.g-monto', form).reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
    $('#gasto-total', form).textContent = 'Total de gastos: ' + money(total);
  };
  $('#add-gasto', form).onclick = () => { list.insertAdjacentHTML('beforeend', gastoRowHtml()); recalc(); };
  form.addEventListener('input', (e) => { if (e.target.classList.contains('g-monto')) recalc(); });
  form.addEventListener('click', (e) => {
    const del = e.target.closest('.g-del');
    if (!del) return;
    const row = del.closest('.gasto-row');
    if ($$('.gasto-row', form).length > 1) row.remove();
    else { $('.g-concepto', row).value = ''; $('.g-monto', row).value = ''; }
    recalc();
  });
  recalc();
}

function collectGastos(form) {
  return $$('.gasto-row', form).map((row) => ({
    concepto: $('.g-concepto', row).value.trim(),
    monto: parseFloat($('.g-monto', row).value) || 0
  })).filter((it) => it.concepto !== '' || it.monto !== 0);
}

// Calcula los renglones de gasto a precargar al editar (compatibilidad con
// registros antiguos que tenían un único monto + comentario).
function gastosPrecarga(rec, montoLegacy) {
  if (rec && Array.isArray(rec.gastosItems) && rec.gastosItems.length) {
    return rec.gastosItems.map((x) => ({ concepto: x.concepto || '', monto: x.monto }));
  }
  if (rec && montoLegacy) return [{ concepto: rec.comentario || '', monto: montoLegacy }];
  return [{ concepto: '', monto: '' }];
}

// Comentario a conservar al guardar: vacío si el comentario antiguo ya pasó
// a ser un concepto de gasto; si no, se preserva tal cual (sin capturarlo).
function comentarioAConservar(rec, montoLegacy) {
  const tieneItems = rec && Array.isArray(rec.gastosItems) && rec.gastosItems.length;
  if (rec && !tieneItems && montoLegacy) return ''; // el comentario se volvió concepto
  return (rec && rec.comentario) || '';
}

function openMovModal(mov) {
  const isEdit = !!mov;
  const today = todayLocal();
  const items = gastosPrecarga(mov, mov?.gastos);
  const keepComment = comentarioAConservar(mov, mov?.gastos);

  const fields =
    field('Fecha', 'fecha', 'date', mov?.fecha || today, 'required') +
    field('Séptima (ingreso)', 'septima', 'number', mov?.septima ?? '', 'step="0.01" min="0" placeholder="0.00"') +
    gastosFieldHtml(items, 'Gastos del día (concepto y monto)') +
    textareaField('Anotación (opcional)', 'comentario', keepComment, 'Aclaración importante del día (aparecerá en el reporte mensual)');

  openModal(isEdit ? 'Editar movimiento' : 'Nuevo movimiento', fields,
    (data, form) => {
      const payload = { fecha: data.fecha, septima: data.septima, comentario: (data.comentario || '').trim(), gastosItems: collectGastos(form) };
      return isEdit
        ? api('PUT', `/api/movimientos/${mov.id}`, payload)
        : api('POST', '/api/movimientos', payload);
    },
    wireGastos);
}

function openReservaModal(r) {
  const isEdit = !!r;
  const ym = todayLocal().slice(0, 7);
  const items = gastosPrecarga(r);
  const fields =
    field('Mes', 'mes', 'month', r?.mes || ym) +
    field('Reserva tomada (ingreso al fondo)', 'monto', 'number', r?.monto ?? '', 'step="0.01" placeholder="0.00"') +
    gastosFieldHtml(items, 'Egresos de la reserva (concepto y monto)') +
    textareaField('Anotación (opcional)', 'comentario', r?.comentario || '');

  openModal(isEdit ? 'Editar registro de reserva' : 'Nuevo registro de reserva', fields,
    (data, form) => {
      const payload = { mes: data.mes, monto: data.monto, comentario: (data.comentario || '').trim(), gastosItems: collectGastos(form) };
      return isEdit
        ? api('PUT', `/api/reserva/${r.id}`, payload)
        : api('POST', '/api/reserva', payload);
    },
    wireGastos);
}

// ---------------------------------------------------------------------------
// Delegación de eventos
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-pdf],[data-edit-mov],[data-del-mov],[data-edit-res],[data-del-res]');
  if (!t) return;

  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.pdf) { e.preventDefault(); return exportMonthlyPdf(t.dataset.pdf); }

  try {
    if (t.dataset.editMov) openMovModal(STATE.rows.find((x) => x.id == t.dataset.editMov));
    else if (t.dataset.delMov) { if (confirm('¿Eliminar este movimiento?')) { STATE = await api('DELETE', `/api/movimientos/${t.dataset.delMov}`); render(); } }
    else if (t.dataset.editRes) openReservaModal(STATE.reserva.find((x) => x.id == t.dataset.editRes));
    else if (t.dataset.delRes) { if (confirm('¿Eliminar este registro de reserva?')) { STATE = await api('DELETE', `/api/reserva/${t.dataset.delRes}`); render(); } }
  } catch (err) { alert(err.message); }
});

$('#modal-close').onclick = closeModal;
$('#modal-cancel').onclick = closeModal;
$('#modal-backdrop').onclick = (e) => { if (e.target.id === 'modal-backdrop') closeModal(); };

// Menú móvil (cajón lateral)
$('#menu-toggle').onclick = () => $('.app').classList.toggle('nav-open');
$('#nav-backdrop').onclick = () => $('.app').classList.remove('nav-open');

// Cerrar sesión
$('#logout-btn').onclick = async () => {
  await api('POST', '/api/logout');
  location.reload();
};

// PWA: registrar el service worker (permite instalar la app y arranque básico offline)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

load();
