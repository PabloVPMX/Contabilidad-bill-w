'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function backend(db) {
  const routes = new Map();
  const app = { use() {}, listen() {}, ...Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, (url, handler) => routes.set(method + ' ' + url, handler)])) };
  const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
  let disk = JSON.stringify(db);
  const fakeFs = {
    existsSync: () => true, readFileSync: () => disk,
    writeFileSync: (_file, content) => { disk = content; }, renameSync() {},
    copyFileSync() {}, readdirSync: () => [], mkdirSync() {}
  };
  const context = vm.createContext({ require: (name) => name === 'express' ? express : name === 'fs' ? fakeFs : require(name), __dirname: root, process: { env: {} }, console: { log() {}, error() {} }, setInterval() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), context);
  function call(method, url, body = {}, id, movId) {
    let status = 200, result;
    const res = { status(n) { status = n; return this; }, json(value) { result = JSON.parse(JSON.stringify(value)); } };
    routes.get(method + ' ' + url)({ body, params: { id, movId } }, res);
    return { status, result };
  }
  return { call, disk: () => JSON.parse(disk) };
}

const legacy = () => ({ saldoInicial: 100, movimientos: [{ id: 1, fecha: '2026-10-05', septima: 50, gastos: 20 }], reserva: [{ id: 1, mes: '2026-10', monto: 30 }], clima: [{ monto: 12 }], promejora: [{ monto: 9 }], seq: { mov: 1, reserva: 1 } });
function frontend(state) {
  const nodes = new Map();
  function node() { return { textContent: '', innerHTML: '', dataset: {}, classList: { toggle() {}, remove() {} }, appendChild() {}, addEventListener() {} }; }
  const document = { querySelector(sel) { if (!nodes.has(sel)) nodes.set(sel, node()); return nodes.get(sel); }, querySelectorAll: () => [], addEventListener() {}, createElement: node };
  const reports = [];
  const context = vm.createContext({ document, navigator: {}, window: { open() { return { document: { open() {}, write(html) { reports.push(html); }, close() {} } }; } }, alert(message) { throw new Error(message); }, console, fetch: async () => ({ ok: true, json: async () => state }) });
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').replace(/\nload\(\);\s*$/, '');
  vm.runInContext(source, context);
  context.inputState = state;
  vm.runInContext('STATE = inputState', context);
  return { context, reports, eval: (code) => vm.runInContext(code, context) };
}


function create(api, motivo = 'Cafetera', meta = 500) {
  return api.call('post', '/api/colectas', { motivo, meta }).result.colectasExtras.at(-1);
}
function add(api, id, fecha, persona, monto, tipo = 'aportacion') {
  return api.call('post', '/api/colectas/:id/movimientos', { fecha, tipo, [tipo === 'aportacion' ? 'persona' : 'concepto']: persona, monto }, id);
}

test('colectas, aportaciones repetidas por persona, gastos, cierre y persistencia', () => {
  const api = backend(legacy());
  const c = create(api);
  add(api, c.id, '2026-11-18', 'Juan', 100);
  add(api, c.id, '2026-11-19', 'María', 150);
  add(api, c.id, '2026-11-20', 'Juan', 50);
  let r = add(api, c.id, '2026-11-21', 'Compra de cafetera', 200, 'gasto').result;
  let summary = r.colectasExtras[0];
  assert.equal(summary.recaudado, 300);
  assert.equal(summary.faltante, 200);
  assert.equal(summary.gastado, 200);
  assert.equal(summary.saldo, 100);
  assert.equal(r.resumen.saldoActual, 130);
  assert.equal(r.resumen.totalReserva, 30);
  assert.deepEqual(summary.movimientos.map((m) => m.fecha), ['2026-11-18','2026-11-19','2026-11-20','2026-11-21']);
  assert.equal(api.call('delete', '/api/colectas/:id', {}, c.id).status, 409);
  api.call('put', '/api/colectas/:id', { motivo: 'Cafetera', meta: 500, estado: 'cerrada' }, c.id);
  assert.equal(add(api, c.id, '2026-11-22', 'Pedro', 10).status, 409);
  api.call('put', '/api/colectas/:id', { motivo: 'Cafetera nueva', meta: 350, estado: 'abierta' }, c.id);
  api.call('put', '/api/colectas/:id/movimientos/:movId', { tipo: 'aportacion', fecha: '2026-10-01', persona: 'Juan corregido', monto: 125.25 }, c.id, 1);
  api.call('delete', '/api/colectas/:id/movimientos/:movId', {}, c.id, 2);
  r = backend(api.disk()).call('get', '/api/state').result;
  assert.equal(r.colectasExtras[0].recaudado, 175.25);
  assert.equal(r.colectasExtras[0].movimientos[0].persona, 'Juan corregido');
  assert.equal(r.colectasExtras[0].saldo, -24.75);
  assert.deepEqual(api.disk().clima, legacy().clima);
  const empty = create(api, 'Otra', 0);
  assert.equal(api.call('delete', '/api/colectas/:id', {}, empty.id).status, 200);
  assert.equal(create(api, 'Tercera').id, empty.id + 1);
});

test('migración del formato anterior agrupa motivos y no duplica ni pierde registros', () => {
  const db = legacy();
  db.septimasExtras = [
    { id: 1, fecha: '2026-11-18', motivo: 'Cafetera', ingresosItems: [{ concepto: 'Juan', monto: 100 }], gastosItems: [] },
    { id: 2, fecha: '2026-11-19', motivo: 'cafetera', ingresosItems: [{ concepto: 'María', monto: 150 }], gastosItems: [{ concepto: 'Compra', monto: 200 }] }
  ];
  const api = backend(db);
  let r = api.call('get', '/api/state').result;
  assert.equal(r.colectasExtras.length, 1);
  assert.equal(r.colectasExtras[0].movimientos.length, 3);
  assert.equal(r.resumen.totalSeptimasExtras, 50);
  add(api, 1, '2026-11-20', 'Juan', 25);
  assert.deepEqual(api.disk().septimasExtras, db.septimasExtras);
  r = backend(api.disk()).call('get', '/api/state').result;
  assert.equal(r.colectasExtras[0].movimientos.length, 4);
  assert.equal(r.resumen.totalSeptimasExtras, 75);
  assert.equal(api.call('post', '/api/septimas-extras', {}).status, 409);
});

test('validación de fechas, nombre, monto, meta y pertenencia a la colecta', () => {
  const api = backend(legacy());
  const c = create(api);
  for (const amount of [-1, 0, 'abc', 1.234, null]) assert.equal(add(api, c.id, '2026-11-18', 'Juan', amount).status, 400);
  assert.equal(add(api, c.id, '2026-02-30', 'Juan', 10).status, 400);
  assert.equal(add(api, c.id, '2026-11-18', ' ', 10).status, 400);
  assert.equal(api.call('post', '/api/colectas', { motivo: ' ', meta: 20 }).status, 400);
  assert.equal(api.call('post', '/api/colectas', { motivo: 'Meta inválida', meta: -5 }).status, 400);
  assert.equal(add(api, 999, '2026-11-18', 'Juan', 10).status, 404);
  assert.equal(api.call('put', '/api/colectas/:id/movimientos/:movId', {}, c.id, 999).status, 404);
  assert.equal(api.call('get', '/api/state').result.colectasExtras[0].movimientos.length, 0);
});

test('reportes por colecta conservan fecha, persona, saldo anterior y meses sin movimientos generales', () => {
  const api = backend(legacy());
  const c = create(api, 'Cafetera <nueva>', 500);
  add(api, c.id, '2026-10-01', 'Juan', 100);
  add(api, c.id, '2026-11-18', 'María', 150);
  add(api, c.id, '2026-11-20', 'Juan', 50);
  add(api, c.id, '2026-11-21', 'Compra', 200, 'gasto');
  const other = create(api, 'Vasos', 0);
  add(api, other.id, '2026-11-20', 'Pedro', 10);
  const state = api.call('get', '/api/state').result;
  const ui = frontend(state);
  const months = JSON.parse(JSON.stringify(ui.eval('mesesConExtras()')));
  assert.deepEqual(months.map((m) => m.mes), ['2026-10', '2026-11']);
  assert.equal(months[1].saldoFinalMes, 130);
  assert.equal(months[1].extrasSaldo, 110);
  ui.eval("exportMonthlyPdf('2026-11')");
  ui.eval("exportDateRangePdf('2026-11-18', '2026-11-21')");
  for (const html of ui.reports) {
    assert.match(html, /Colecta: Cafetera &lt;nueva&gt;/);
    assert.match(html, /Colecta: Vasos/);
    assert.match(html, /18\/11\/2026/);
    assert.match(html, /20\/11\/2026/);
    assert.match(html, /María/);
    assert.match(html, /Juan/);
    assert.match(html, /Compra/);
    assert.match(html, /Saldo anterior: \$100\.00/);
    assert.match(html, /Saldo al cierre: \$100\.00/);
    assert.match(html, /\$110\.00/);
  }
  assert.match(ui.eval("reporteExtrasHtml('2026-12-01', '2026-12-31')"), /Sin movimientos de Séptimas extras/);
});

