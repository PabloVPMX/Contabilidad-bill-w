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
  function call(method, url, body = {}, id) {
    let status = 200, result;
    const res = { status(n) { status = n; return this; }, json(value) { result = JSON.parse(JSON.stringify(value)); } };
    routes.get(method + ' ' + url)({ body, params: { id } }, res);
    return { status, result };
  }
  return { call, disk: () => JSON.parse(disk) };
}

const legacy = () => ({ saldoInicial: 100, movimientos: [{ id: 1, fecha: '2026-10-05', septima: 50, gastos: 20 }], reserva: [{ id: 1, mes: '2026-10', monto: 30 }], clima: [{ monto: 12 }], promejora: [{ monto: 9 }], seq: { mov: 1, reserva: 1 } });
const payload = (fecha, monto = 100) => ({ fecha, motivo: 'Cooperación <especial>', ingresosItems: [{ concepto: 'Aportación A', monto }, { concepto: 'Aportación B', monto: 25.25 }], gastosItems: [{ concepto: 'Materiales', monto: 20.10 }] });

test('CRUD, orden cronológico, saldo independiente, persistencia e historial', () => {
  const api = backend(legacy());
  let r = api.call('get', '/api/state').result;
  assert.deepEqual(r.septimasExtras, []);
  assert.equal(r.resumen.saldoActual, 130);
  assert.equal(r.resumen.totalReserva, 30);
  api.call('post', '/api/septimas-extras', payload('2026-11-18'));
  r = api.call('post', '/api/septimas-extras', payload('2026-10-01', 50)).result;
  assert.deepEqual(r.septimasExtras.map((x) => x.id), [2, 1]);
  assert.equal(r.septimasExtras[0].saldo, 55.15);
  assert.equal(r.resumen.totalSeptimasExtras, 160.30);
  assert.equal(r.resumen.saldoActual, 130);
  assert.equal(r.resumen.totalReserva, 30);
  r = api.call('put', '/api/septimas-extras/:id', { fecha: '2026-12-01', motivo: 'Compra', ingresosItems: [], gastosItems: [{ concepto: 'Sillas', monto: 10 }] }, 2).result;
  assert.deepEqual(r.septimasExtras.map((x) => x.id), [1, 2]);
  assert.equal(r.resumen.totalSeptimasExtras, 95.15);
  const disk = api.disk();
  assert.deepEqual(disk.clima, legacy().clima);
  assert.deepEqual(disk.promejora, legacy().promejora);
  const restarted = backend(disk);
  assert.equal(restarted.call('get', '/api/state').result.resumen.totalSeptimasExtras, 95.15);
  r = restarted.call('post', '/api/septimas-extras', payload('2026-12-02')).result;
  assert.equal(r.septimasExtras.at(-1).id, 3);
  r = restarted.call('delete', '/api/septimas-extras/:id', {}, 1).result;
  assert.equal(r.resumen.totalSeptimasExtras, 95.15);
  assert.equal(restarted.call('delete', '/api/septimas-extras/:id', {}, 999).status, 404);
});

test('rechaza fechas, conceptos y montos inválidos sin cambiar la base', () => {
  const api = backend(legacy());
  for (const value of [
    { ...payload('2026-02-30') }, { ...payload(''), motivo: '' },
    { ...payload('2026-11-18'), motivo: '  ' },
    ...[-1, 0, 'abc', 1.234, null].map((monto) => ({ ...payload('2026-11-18'), ingresosItems: [{ concepto: 'Inválido', monto }] })),
    { ...payload('2026-11-18'), ingresosItems: [{ concepto: '', monto: 10 }] },
    { ...payload('2026-11-18'), ingresosItems: null },
    { fecha: '2026-11-18', motivo: 'Vacío', ingresosItems: [], gastosItems: [] }
  ]) assert.equal(api.call('post', '/api/septimas-extras', value).status, 400, JSON.stringify(value));
  assert.equal(api.call('get', '/api/state').result.septimasExtras.length, 0);
});

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

test('reportes mensual y por rango incluyen fondo, conceptos y meses solo con extras', () => {
  const api = backend(legacy());
  api.call('post', '/api/septimas-extras', payload('2026-10-01', 50));
  api.call('post', '/api/septimas-extras', payload('2026-11-18'));
  const state = api.call('get', '/api/state').result;
  const ui = frontend(state);
  const months = JSON.parse(JSON.stringify(ui.eval('mesesConExtras()')));
  assert.deepEqual(months.map((m) => m.mes), ['2026-10', '2026-11']);
  assert.equal(months[1].saldoFinalMes, 130);
  assert.equal(months[1].extrasSaldo, 160.30);
  ui.eval("exportMonthlyPdf('2026-11')");
  ui.eval("exportDateRangePdf('2026-11-18', '2026-11-18')");
  for (const html of ui.reports) {
    assert.match(html, /Séptimas extras · Fondo independiente/);
    assert.match(html, /\$55\.15/);
    assert.match(html, /\$125\.25/);
    assert.match(html, /\$20\.10/);
    assert.match(html, /\$160\.30/);
    assert.match(html, /Aportación A/);
    assert.match(html, /Materiales/);
    assert.match(html, /Cooperación &lt;especial&gt;/);
    assert.match(html, /Entrada/);
    assert.match(html, /Salida/);
  }
  assert.equal(ui.reports.length, 2);
  const noActivity = ui.eval("reporteExtrasHtml('2026-12-01', '2026-12-31')");
  assert.match(noActivity, /Sin movimientos de Séptimas extras/);
  assert.match(noActivity, /\$160\.30/);
  assert.throws(() => ui.eval("exportDateRangePdf('2026-11-20', '2026-11-01')"), /rango/);
});

