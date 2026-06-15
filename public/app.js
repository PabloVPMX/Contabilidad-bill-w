'use strict';

let STATE = null;
let VIEW = 'general';
let MOV_FILTER = 'all'; // filtro por mes en la vista Movimientos

const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

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
  general: 'Resumen general',
  meses: 'Resúmenes por mes',
  movimientos: 'Movimientos',
  reserva: 'Reserva',
  promejora: 'Promejora',
  clima: 'Aportación clima'
};

function render() {
  if (!STATE) return;
  const r = STATE.resumen;
  $('#ss-saldo').textContent = money(r.saldoActual);
  $('#ss-reserva').textContent = money(r.totalReserva);
  $('#ss-clima').textContent = money(r.totalClima);
  $('#view-title').textContent = TITLES[VIEW];

  const actions = $('#topbar-actions');
  actions.innerHTML = '';
  if (VIEW === 'movimientos') actions.appendChild(btn('+ Nuevo movimiento', 'primary', () => openMovModal()));
  if (VIEW === 'clima') actions.appendChild(btn('+ Nueva aportación', 'primary', () => openClimaModal()));
  if (VIEW === 'reserva') actions.appendChild(btn('+ Nuevo registro', 'primary', () => openReservaModal()));
  if (VIEW === 'promejora') actions.appendChild(btn('+ Nuevo movimiento', 'primary', () => openPromejoraModal()));

  const root = $('#view-root');
  root.innerHTML = '';
  ({
    general: viewGeneral,
    meses: viewMeses,
    movimientos: viewMovimientos,
    reserva: viewReserva,
    promejora: viewPromejora,
    clima: viewClima
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
// Vista: Resumen general (ejecutivo)
function viewGeneral(root) {
  const r = STATE.resumen;
  const neto = r.totalSeptimas - r.totalGastos;

  const kpis = document.createElement('div');
  kpis.className = 'kpis';
  kpis.innerHTML = `
    <div class="kpi accent">
      <div class="label">Saldo actual</div>
      <div class="value">${money(r.saldoActual)}</div>
      <div class="sub">${r.numMovimientos} movimientos registrados</div>
    </div>
    <div class="kpi">
      <div class="label">Total séptimas (ingresos)</div>
      <div class="value pos">${money(r.totalSeptimas)}</div>
      <div class="sub">+ saldo inicial ${money(r.saldoInicial)}</div>
    </div>
    <div class="kpi">
      <div class="label">Total gastos</div>
      <div class="value neg">${money(r.totalGastos)}</div>
      <div class="sub">Neto ${money(neto)}</div>
    </div>
    <div class="kpi">
      <div class="label">Reserva</div>
      <div class="value">${money(r.totalReserva)}</div>
      <div class="sub">Fondo del saldo final mensual</div>
    </div>
    <div class="kpi">
      <div class="label">Aportación clima</div>
      <div class="value">${money(r.totalClima)}</div>
      <div class="sub">Independiente del saldo general</div>
    </div>
    <div class="kpi">
      <div class="label">Promejora</div>
      <div class="value">${money(r.promejora)}</div>
      <div class="sub">Fondo complementario</div>
    </div>`;
  root.appendChild(kpis);

  // Resumen tipo hoja original
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h2>Resumen ejecutivo general</h2></div>
    <div class="card-body">
      <table>
        <tbody>
          <tr><td>Saldo inicial</td><td class="num">${money(r.saldoInicial)}</td></tr>
          <tr><td>Total séptimas (ingresos)</td><td class="num pos">${money(r.totalSeptimas)}</td></tr>
          <tr><td><b>Total ingresos</b> (saldo inicial + séptimas)</td><td class="num"><b>${money(r.totalIngresos)}</b></td></tr>
          <tr><td>Total gastos</td><td class="num neg">${money(r.totalGastos)}</td></tr>
          <tr><td><b>Saldo actual</b></td><td class="num"><b>${money(r.saldoActual)}</b></td></tr>
          <tr><td>Reserva</td><td class="num">${money(r.totalReserva)}</td></tr>
          <tr><td>Aportación clima (independiente)</td><td class="num">${money(r.totalClima)}</td></tr>
          <tr><td>Promejora</td><td class="num">${money(r.promejora)}</td></tr>
        </tbody>
      </table>
    </div>`;
  root.appendChild(card);

  // Mini gráfico mensual
  root.appendChild(monthlyBars());
}

function monthlyBars() {
  const meses = STATE.meses;
  const card = document.createElement('div');
  card.className = 'card';
  if (!meses.length) { card.innerHTML = '<div class="empty">Aún no hay movimientos.</div>'; return card; }
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
// Vista: Resúmenes por mes
function viewMeses(root) {
  const meses = STATE.meses;
  if (!meses.length) { root.innerHTML = '<div class="card"><div class="empty">Aún no hay movimientos.</div></div>'; return; }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h2>Resumen ejecutivo por mes</h2></div>
    <div class="card-body">
      <table>
        <thead><tr>
          <th>Mes</th><th class="num">Movs.</th>
          <th class="num">Ingresos</th><th class="num">Gastos</th>
          <th class="num">Neto</th><th class="num">Saldo fin de mes</th><th></th>
        </tr></thead>
        <tbody>
          ${meses.map((m) => `<tr>
            <td><b>${esc(mesLabel(m.mes))}</b></td>
            <td class="num">${m.movimientos}</td>
            <td class="num pos">${money(m.ingresos)}</td>
            <td class="num neg">${money(m.gastos)}</td>
            <td class="num ${m.neto >= 0 ? 'pos' : 'neg'}">${money(m.neto)}</td>
            <td class="num"><b>${money(m.saldoFinalMes)}</b></td>
            <td class="num"><button class="btn" data-pdf="${m.mes}">📄 PDF</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Vista: Movimientos
function viewMovimientos(root) {
  const r = STATE.resumen;
  const kpis = document.createElement('div');
  kpis.className = 'kpis';
  kpis.innerHTML = `
    <div class="kpi"><div class="label">Séptimas</div><div class="value pos">${money(r.totalSeptimas)}</div></div>
    <div class="kpi"><div class="label">Gastos</div><div class="value neg">${money(r.totalGastos)}</div></div>
    <div class="kpi accent"><div class="label">Saldo actual</div><div class="value">${money(r.saldoActual)}</div></div>`;
  root.appendChild(kpis);

  // Filtro por mes
  const meses = STATE.meses.map((m) => m.mes);
  if (MOV_FILTER !== 'all' && !meses.includes(MOV_FILTER)) MOV_FILTER = 'all';
  const filtered = MOV_FILTER === 'all' ? STATE.rows : STATE.rows.filter((x) => x.mes === MOV_FILTER);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      <h2>Movimientos ${MOV_FILTER === 'all' ? '(todos)' : '· ' + esc(mesLabel(MOV_FILTER))}</h2>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#334155;margin:0">
        Mes:
        <select id="mov-filter" style="width:auto;min-width:150px">
          <option value="all"${MOV_FILTER === 'all' ? ' selected' : ''}>Todos los meses</option>
          ${meses.map((m) => `<option value="${m}"${MOV_FILTER === m ? ' selected' : ''}>${esc(mesLabel(m))}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="card-body">${tablaMovs(filtered, true)}</div>`;
  root.appendChild(card);

  $('#mov-filter').onchange = (e) => { MOV_FILTER = e.target.value; render(); };
}

function comentarioGastos(r) {
  const parts = [];
  if (Array.isArray(r.gastosItems) && r.gastosItems.length) {
    parts.push(r.gastosItems.map((it) =>
      `<div class="g-line"><span>${esc(it.concepto) || '<span class="muted">Sin concepto</span>'}</span><b>${money(it.monto)}</b></div>`
    ).join(''));
  }
  if (r.comentario) parts.push(`<div>${esc(r.comentario)}</div>`);
  return parts.length ? `<div class="gastos-desglose">${parts.join('')}</div>` : '<span class="muted">—</span>';
}

function tablaMovs(rows, withActions) {
  if (!rows.length) return '<div class="empty">Sin movimientos.</div>';
  return `<table>
    <thead><tr>
      <th>Fecha</th><th class="num">Saldo ant.</th><th class="num">Séptima</th>
      <th class="num">Gastos</th><th class="num">Total</th><th>Comentarios</th>
      ${withActions ? '<th></th>' : ''}
    </tr></thead>
    <tbody>
      ${rows.slice().reverse().map((r) => `<tr>
        <td>${esc(fechaLabel(r.fecha))}</td>
        <td class="num muted">${money(r.saldoAnterior)}</td>
        <td class="num ${r.septima ? 'pos' : 'muted'}">${r.septima ? money(r.septima) : '—'}</td>
        <td class="num ${r.gastos ? 'neg' : 'muted'}">${r.gastos ? money(r.gastos) : '—'}</td>
        <td class="num"><b>${money(r.total)}</b></td>
        <td>${comentarioGastos(r)}</td>
        ${withActions ? `<td><div class="row-actions">
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
    <div class="card-body">${r.length ? `<table>
      <thead><tr><th>Mes</th><th class="num">Monto</th><th>Comentario</th><th></th></tr></thead>
      <tbody>${r.map((x) => `<tr>
        <td>${esc(x.mes ? mesLabel(x.mes) : '—')}</td>
        <td class="num"><b>${money(x.monto)}</b></td>
        <td>${esc(x.comentario) || '<span class="muted">—</span>'}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-res="${x.id}">✏️</button>
          <button class="icon-btn" data-del-res="${x.id}">🗑️</button>
        </div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Sin registros de reserva.</div>'}</div>`;
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Vista: Promejora (saldo independiente con ingresos y gastos)
function viewPromejora(root) {
  const r = STATE.resumen;
  const movs = STATE.promejora;

  const kpis = document.createElement('div');
  kpis.className = 'kpis';
  kpis.innerHTML = `
    <div class="kpi accent"><div class="label">Saldo promejora</div><div class="value">${money(r.promejora)}</div>
      <div class="sub">Fondo independiente del saldo general</div></div>
    <div class="kpi"><div class="label">Ingresos promejora</div><div class="value pos">${money(r.promejoraIngresos)}</div></div>
    <div class="kpi"><div class="label">Gastos promejora</div><div class="value neg">${money(r.promejoraGastos)}</div></div>`;
  root.appendChild(kpis);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h2>Movimientos de promejora</h2></div>
    <div class="card-body">${movs.length ? `<table>
      <thead><tr><th>Fecha</th><th class="num">Ingreso</th><th class="num">Gasto</th><th>Concepto</th><th></th></tr></thead>
      <tbody>${movs.slice().reverse().map((x) => `<tr>
        <td>${esc(fechaLabel(x.fecha))}</td>
        <td class="num ${x.ingreso ? 'pos' : 'muted'}">${x.ingreso ? money(x.ingreso) : '—'}</td>
        <td class="num ${x.gasto ? 'neg' : 'muted'}">${x.gasto ? money(x.gasto) : '—'}</td>
        <td>${esc(x.comentario) || '<span class="muted">—</span>'}</td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-pro="${x.id}">✏️</button>
          <button class="icon-btn" data-del-pro="${x.id}">🗑️</button>
        </div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Sin movimientos de promejora. Usa “+ Nuevo movimiento” para registrar ingresos o gastos.</div>'}</div>`;
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Vista: Aportación clima
function viewClima(root) {
  const c = STATE.clima;
  const total = STATE.resumen.totalClima;
  const kpi = document.createElement('div');
  kpi.className = 'kpis';
  kpi.innerHTML = `<div class="kpi accent"><div class="label">Total aportación clima</div><div class="value">${money(total)}</div>
    <div class="sub">Fondo independiente del saldo general · ${c.length} aportaciones</div></div>`;
  root.appendChild(kpi);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="card-head"><h2>Aportaciones</h2></div>
    <div class="card-body">${c.length ? `<table>
      <thead><tr><th>Nombre</th><th class="num">Monto</th><th></th></tr></thead>
      <tbody>${c.map((x) => `<tr>
        <td>${esc(x.nombre)}</td>
        <td class="num"><b>${money(x.monto)}</b></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit-cli="${x.id}">✏️</button>
          <button class="icon-btn" data-del-cli="${x.id}">🗑️</button>
        </div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Sin aportaciones registradas.</div>'}</div>`;
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Exportar reporte de tesorería mensual a PDF (vía impresión del navegador)
function exportMonthlyPdf(mes) {
  const m = STATE.meses.find((x) => x.mes === mes);
  if (!m) return;
  const rows = STATE.rows.filter((r) => r.mes === mes);
  const ingresosRows = rows.filter((r) => r.septima > 0);
  const hoy = fechaLabel(new Date().toISOString().slice(0, 10));

  const proMes = STATE.promejora.filter((p) => p.mes === mes);
  const proIngresos = proMes.reduce((a, r) => a + (Number(r.ingreso) || 0), 0);
  const proGastosRows = proMes.filter((r) => r.gasto > 0);
  const proGastosTotal = proMes.reduce((a, r) => a + (Number(r.gasto) || 0), 0);
  const desglosePromejora = proGastosRows.length
    ? proGastosRows.map((r) => `<tr>
        <td>${esc(fechaLabel(r.fecha))}</td>
        <td>${esc(r.comentario) || 'Sin concepto especificado'}</td>
        <td class="num">${money(r.gasto)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#666">Sin gastos de promejora en el mes.</td></tr>';

  const reservaMes = STATE.reserva.filter((r) => r.mes === mes);
  const totalReservaMes = reservaMes.reduce((a, r) => a + (Number(r.monto) || 0), 0);
  const totalReserva = STATE.resumen.totalReserva;
  const totalClima = STATE.resumen.totalClima;

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
      <tr><td>Neto del mes</td><td class="num">${money(m.neto)}</td></tr>
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

    <h2>Promejora <span style="font-weight:400;font-size:11px;color:#777">(fondo independiente del saldo general)</span></h2>
    <table class="resumen"><tbody>
      <tr><td>Ingresos de promejora del mes</td><td class="num pos">${money(proIngresos)}</td></tr>
      <tr class="total-row"><td>Saldo de promejora (acumulado)</td><td class="num">${money(STATE.resumen.promejora)}</td></tr>
    </tbody></table>
    <table style="margin-top:10px"><thead><tr><th>Fecha</th><th>Concepto (gasto promejora)</th><th class="num">Monto</th></tr></thead><tbody>
      ${desglosePromejora}
      <tr class="total-row"><td colspan="2">Total gastos promejora</td><td class="num neg">${money(proGastosTotal)}</td></tr>
    </tbody></table>

    <h2>Reserva</h2>
    <table><tbody>
      <tr><td>Reserva tomada en el mes</td><td class="num">${money(totalReservaMes)}</td></tr>
      <tr class="total-row"><td>Reserva acumulada (total)</td><td class="num">${money(totalReserva)}</td></tr>
    </tbody></table>

    <h2>Aportación clima <span style="font-weight:400;font-size:11px;color:#777">(fondo independiente del saldo general)</span></h2>
    <table><thead><tr><th>Nombre</th><th class="num">Monto</th></tr></thead><tbody>
      ${STATE.clima.length ? STATE.clima.map((c) => `<tr><td>${esc(c.nombre)}</td><td class="num">${money(c.monto)}</td></tr>`).join('') : '<tr><td colspan="2" style="text-align:center;color:#666">Sin aportaciones registradas.</td></tr>'}
      <tr class="total-row"><td>Saldo del clima</td><td class="num">${money(totalClima)}</td></tr>
    </tbody></table>

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

function gastoRowHtml(concepto = '', monto = '') {
  const m = (monto !== '' && monto != null) ? esc(monto) : '';
  return `<div class="gasto-row">
    <input class="g-concepto" type="text" placeholder="Concepto del gasto" value="${esc(concepto)}" />
    <input class="g-monto" type="number" step="0.01" min="0" placeholder="0.00" value="${m}" />
    <button type="button" class="icon-btn g-del" title="Quitar renglón">🗑️</button>
  </div>`;
}

function openMovModal(mov) {
  const isEdit = !!mov;
  const today = new Date().toISOString().slice(0, 10);

  // Renglones de gasto a precargar (compatibilidad con movimientos antiguos)
  let items = [];
  let generalComment = mov?.comentario || '';
  if (mov) {
    if (Array.isArray(mov.gastosItems) && mov.gastosItems.length) {
      items = mov.gastosItems.map((x) => ({ concepto: x.concepto || '', monto: x.monto }));
    } else if (mov.gastos) {
      items = [{ concepto: mov.comentario || '', monto: mov.gastos }];
      generalComment = '';
    }
  }
  if (!items.length) items = [{ concepto: '', monto: '' }];

  const fields =
    field('Fecha', 'fecha', 'date', mov?.fecha || today, 'required') +
    field('Séptima (ingreso)', 'septima', 'number', mov?.septima ?? 0, 'step="0.01" min="0"') +
    `<div class="field">
      <span>Gastos del día (concepto y monto)</span>
      <div id="gastos-list">${items.map((it) => gastoRowHtml(it.concepto, it.monto)).join('')}</div>
      <button type="button" class="btn ghost" id="add-gasto" style="margin-top:4px">+ Agregar concepto de gasto</button>
      <div class="gasto-total muted" id="gasto-total" style="margin-top:8px"></div>
    </div>` +
    `<label class="field"><span>Comentario general (opcional)</span>
      <textarea name="comentario" rows="2">${esc(generalComment)}</textarea></label>`;

  openModal(isEdit ? 'Editar movimiento' : 'Nuevo movimiento', fields,
    (data, form) => {
      const gastosItems = $$('.gasto-row', form).map((row) => ({
        concepto: $('.g-concepto', row).value.trim(),
        monto: parseFloat($('.g-monto', row).value) || 0
      })).filter((it) => it.concepto !== '' || it.monto !== 0);
      const payload = {
        fecha: data.fecha,
        septima: data.septima,
        comentario: data.comentario || '',
        gastosItems
      };
      return isEdit
        ? api('PUT', `/api/movimientos/${mov.id}`, payload)
        : api('POST', '/api/movimientos', payload);
    },
    (form) => {
      const list = $('#gastos-list', form);
      const recalc = () => {
        const total = $$('.g-monto', form).reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
        $('#gasto-total', form).textContent = 'Total de gastos del día: ' + money(total);
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
    });
}

function openClimaModal(c) {
  const isEdit = !!c;
  openModal(isEdit ? 'Editar aportación' : 'Nueva aportación clima',
    field('Nombre', 'nombre', 'text', c?.nombre || '', 'required') +
    field('Monto', 'monto', 'number', c?.monto ?? 0, 'step="0.01" min="0" required'),
    (data) => isEdit
      ? api('PUT', `/api/clima/${c.id}`, data)
      : api('POST', '/api/clima', data));
}

function openPromejoraModal(p) {
  const isEdit = !!p;
  const today = new Date().toISOString().slice(0, 10);
  openModal(isEdit ? 'Editar movimiento de promejora' : 'Nuevo movimiento de promejora',
    field('Fecha', 'fecha', 'date', p?.fecha || today, 'required') +
    field('Ingreso', 'ingreso', 'number', p?.ingreso ?? 0, 'step="0.01" min="0"') +
    field('Gasto', 'gasto', 'number', p?.gasto ?? 0, 'step="0.01" min="0"') +
    `<label class="field"><span>Concepto</span>
      <textarea name="comentario" rows="3">${esc(p?.comentario || '')}</textarea></label>`,
    (data) => isEdit
      ? api('PUT', `/api/promejora/${p.id}`, data)
      : api('POST', '/api/promejora', data));
}

function openReservaModal(r) {
  const isEdit = !!r;
  const ym = new Date().toISOString().slice(0, 7);
  openModal(isEdit ? 'Editar registro de reserva' : 'Nuevo registro de reserva',
    field('Mes', 'mes', 'month', r?.mes || ym) +
    field('Monto', 'monto', 'number', r?.monto ?? 0, 'step="0.01" required') +
    `<label class="field"><span>Comentario</span>
      <textarea name="comentario" rows="2">${esc(r?.comentario || '')}</textarea></label>`,
    (data) => isEdit
      ? api('PUT', `/api/reserva/${r.id}`, data)
      : api('POST', '/api/reserva', data));
}

// ---------------------------------------------------------------------------
// Delegación de eventos
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-pdf],[data-edit-mov],[data-del-mov],[data-edit-cli],[data-del-cli],[data-edit-res],[data-del-res],[data-edit-pro],[data-del-pro]');
  if (!t) return;

  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.pdf) { e.preventDefault(); return exportMonthlyPdf(t.dataset.pdf); }

  try {
    if (t.dataset.editMov) openMovModal(STATE.rows.find((x) => x.id == t.dataset.editMov));
    else if (t.dataset.delMov) { if (confirm('¿Eliminar este movimiento?')) { STATE = await api('DELETE', `/api/movimientos/${t.dataset.delMov}`); render(); } }
    else if (t.dataset.editCli) openClimaModal(STATE.clima.find((x) => x.id == t.dataset.editCli));
    else if (t.dataset.delCli) { if (confirm('¿Eliminar esta aportación?')) { STATE = await api('DELETE', `/api/clima/${t.dataset.delCli}`); render(); } }
    else if (t.dataset.editRes) openReservaModal(STATE.reserva.find((x) => x.id == t.dataset.editRes));
    else if (t.dataset.delRes) { if (confirm('¿Eliminar este registro de reserva?')) { STATE = await api('DELETE', `/api/reserva/${t.dataset.delRes}`); render(); } }
    else if (t.dataset.editPro) openPromejoraModal(STATE.promejora.find((x) => x.id == t.dataset.editPro));
    else if (t.dataset.delPro) { if (confirm('¿Eliminar este movimiento de promejora?')) { STATE = await api('DELETE', `/api/promejora/${t.dataset.delPro}`); render(); } }
  } catch (err) { alert(err.message); }
});

$('#modal-close').onclick = closeModal;
$('#modal-cancel').onclick = closeModal;
$('#modal-backdrop').onclick = (e) => { if (e.target.id === 'modal-backdrop') closeModal(); };

// Menú móvil (cajón lateral)
$('#menu-toggle').onclick = () => $('.app').classList.toggle('nav-open');
$('#nav-backdrop').onclick = () => $('.app').classList.remove('nav-open');

load();
