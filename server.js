'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// El directorio /data se monta como volumen persistente en EasyPanel.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

// Respaldos automáticos: un snapshot por día dentro del volumen, en /data/backups.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '30', 10); // días a conservar

// ---------------------------------------------------------------------------
// Acceso por palabra secreta (sin usuario/contraseña). Se puede cambiar con
// la variable de entorno SECRET_WORD. La cookie guarda un hash, no la palabra.
// ---------------------------------------------------------------------------
const SECRET_WORD = (process.env.SECRET_WORD || 'recuperacion').trim().toLowerCase();
const AUTH_TOKEN = crypto.createHash('sha256').update('billw:' + SECRET_WORD).digest('hex');

function parseCookies(req) {
  return (req.headers.cookie || '').split(';').reduce((acc, part) => {
    const i = part.indexOf('=');
    if (i > -1) acc[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    return acc;
  }, {});
}
const isAuthed = (req) => parseCookies(req).auth === AUTH_TOKEN;

function loginPage(error) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acceso · Grupo Bill W</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        font-family: "Segoe UI", system-ui, Arial, sans-serif; background: #0f172a; color: #e5e7eb; padding: 20px; }
      .box { width: min(380px, 100%); background: #111827; border: 1px solid rgba(255,255,255,.08);
        border-radius: 16px; padding: 28px 24px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
      img { width: 64px; height: 64px; border-radius: 12px; background: #fff; padding: 6px; object-fit: contain; }
      h1 { font-size: 18px; margin: 14px 0 4px; }
      p { color: #94a3b8; font-size: 13px; margin: 0 0 20px; }
      input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid #334155;
        background: #0b1220; color: #fff; font-size: 15px; text-align: center; }
      button { width: 100%; margin-top: 12px; padding: 12px; border: 0; border-radius: 10px;
        background: #2563eb; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
      button:hover { background: #1d4ed8; }
      .err { color: #f87171; font-size: 13px; margin-top: 12px; min-height: 18px; }
    </style></head><body>
    <form class="box" method="POST" action="/api/login">
      <img src="/logo.webp" alt="A.A.">
      <h1>Grupo Bill W · Contabilidad</h1>
      <p>Ingresa la palabra de acceso para continuar.</p>
      <input name="word" type="password" placeholder="Palabra de acceso" autofocus autocomplete="off" required>
      <button type="submit">Entrar</button>
      <div class="err">${error ? 'Palabra incorrecta. Intenta de nuevo.' : ''}</div>
    </form>
  </body></html>`;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false })); // formulario de acceso

// Iniciar/cerrar sesión
app.post('/api/login', (req, res) => {
  const word = String((req.body && req.body.word) || '').trim().toLowerCase();
  if (word && word === SECRET_WORD) {
    const oneYear = 60 * 60 * 24 * 365;
    res.setHeader('Set-Cookie', `auth=${AUTH_TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${oneYear}`);
    // Si vino del formulario HTML, redirige; si vino por fetch, responde JSON.
    if ((req.headers.accept || '').includes('text/html')) return res.redirect('/');
    return res.json({ ok: true });
  }
  if ((req.headers.accept || '').includes('text/html')) return res.status(401).send(loginPage(true));
  res.status(401).json({ error: 'Palabra incorrecta' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// A partir de aquí, todo requiere haber ingresado la palabra de acceso.
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (req.path === '/logo.webp') return next(); // logo visible en la página de acceso
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
  res.status(200).send(loginPage(false));
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Almacenamiento (archivo JSON con escritura atómica). Suficiente y robusto
// para un volumen de datos pequeño y un solo tesorero editando a la vez.
// ---------------------------------------------------------------------------
function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
    const db = {
      saldoInicial: seed.saldoInicial || 0,
      promejora: seed.promejora || 0,
      movimientos: (seed.movimientos || []).map((m, i) => ({ id: i + 1, ...m })),
      clima: (seed.clima || []).map((c, i) => ({ id: i + 1, ...c })),
      reserva: (seed.reserva || []).map((r, i) => ({ id: i + 1, ...r })),
      promejora: [],
      seq: { mov: (seed.movimientos || []).length, clima: (seed.clima || []).length, reserva: (seed.reserva || []).length, promejora: 0 }
    };
    writeDb(db);
    return db;
  }
  return readDb();
}

// Normaliza bases existentes (migra "promejora" numérica al nuevo libro)
function normalizeDb(db) {
  db.seq = db.seq || {};
  if (!Array.isArray(db.promejora)) {
    const old = parseFloat(db.promejora);
    db.promejora = Number.isFinite(old) && old !== 0
      ? [{ id: 1, fecha: '', ingreso: old, gasto: 0, comentario: 'Saldo inicial de promejora' }]
      : [];
  }
  if (db.seq.promejora == null) db.seq.promejora = db.promejora.length;
  return db;
}

function readDb() {
  return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')));
}

function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

// Crea un respaldo diario (db-YYYY-MM-DD.json) y conserva solo los últimos
// BACKUP_KEEP. Si ya existe el del día, lo sobrescribe (un snapshot por día).
function makeBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-${stamp}.json`));
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('db-') && f.endsWith('.json'))
      .sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) {
    console.error('Error al crear respaldo:', e.message);
  }
}

let DB = ensureDb();
function save() { writeDb(DB); }

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Suma de los renglones de gasto de un movimiento (o null si no usa renglones).
function gastosItemsTotal(m) {
  if (!Array.isArray(m.gastosItems) || !m.gastosItems.length) return null;
  return m.gastosItems.reduce((a, it) => a + num(it.monto), 0);
}

// Limpia los renglones de gasto recibidos del cliente: descarta los vacíos.
function parseGastosItems(items) {
  if (!Array.isArray(items)) return null;
  return items
    .map((it) => ({ concepto: String((it && it.concepto) || '').trim(), monto: num(it && it.monto) }))
    .filter((it) => it.concepto !== '' || it.monto !== 0);
}

// ---------------------------------------------------------------------------
// Cálculo del estado completo (saldos corridos + resúmenes ejecutivos)
// ---------------------------------------------------------------------------
function computeState() {
  const movs = [...DB.movimientos];

  let saldo = num(DB.saldoInicial);
  const rows = movs.map((m) => {
    const saldoAnterior = saldo;
    const septima = num(m.septima);
    const itemsTotal = gastosItemsTotal(m);
    const gastos = itemsTotal != null ? itemsTotal : num(m.gastos);
    const total = saldoAnterior + septima - gastos;
    saldo = total;
    return {
      id: m.id,
      fecha: m.fecha || '',
      mes: (m.fecha || '').slice(0, 7),
      septima,
      gastos,
      comentario: m.comentario || '',
      gastosItems: Array.isArray(m.gastosItems) ? m.gastosItems : null,
      saldoAnterior,
      total
    };
  });

  const totalSeptimas = rows.reduce((a, r) => a + r.septima, 0);
  const totalGastos = rows.reduce((a, r) => a + r.gastos, 0);
  const saldoActual = rows.length ? rows[rows.length - 1].total : num(DB.saldoInicial);

  // Resumen por mes (ejecutivo)
  const mesesMap = new Map();
  for (const r of rows) {
    const key = r.mes || 'sin-fecha';
    if (!mesesMap.has(key)) {
      mesesMap.set(key, {
        mes: key,
        ingresos: 0,
        gastos: 0,
        movimientos: 0,
        saldoInicialMes: r.saldoAnterior,
        saldoFinalMes: r.total
      });
    }
    const g = mesesMap.get(key);
    g.ingresos += r.septima;
    g.gastos += r.gastos;
    g.movimientos += 1;
    g.saldoFinalMes = r.total;
  }
  const meses = [...mesesMap.values()]
    .map((g) => ({ ...g, neto: g.ingresos - g.gastos }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const totalClima = DB.clima.reduce((a, c) => a + num(c.monto), 0);
  const totalReserva = DB.reserva.reduce((a, r) => a + num(r.monto), 0);

  // Promejora: saldo independiente con su propio libro de ingresos/gastos
  const promejoraRows = DB.promejora.map((p) => {
    const itemsTotal = gastosItemsTotal(p);
    return {
      id: p.id,
      fecha: p.fecha || '',
      mes: (p.fecha || '').slice(0, 7),
      ingreso: num(p.ingreso),
      gasto: itemsTotal != null ? itemsTotal : num(p.gasto),
      comentario: p.comentario || '',
      gastosItems: Array.isArray(p.gastosItems) ? p.gastosItems : null
    };
  }).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  const promejoraIngresos = promejoraRows.reduce((a, r) => a + r.ingreso, 0);
  const promejoraGastos = promejoraRows.reduce((a, r) => a + r.gasto, 0);
  const promejoraSaldo = promejoraIngresos - promejoraGastos;

  return {
    saldoInicial: num(DB.saldoInicial),
    rows,
    resumen: {
      saldoInicial: num(DB.saldoInicial),
      totalSeptimas,
      totalGastos,
      // "Total ingresos" como en la hoja original = saldo inicial + séptimas
      totalIngresos: num(DB.saldoInicial) + totalSeptimas,
      saldoActual,
      totalReserva,
      totalClima,
      promejora: promejoraSaldo,
      promejoraIngresos,
      promejoraGastos,
      numMovimientos: rows.length
    },
    meses,
    clima: DB.clima,
    reserva: DB.reserva,
    promejora: promejoraRows
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/state', (req, res) => res.json(computeState()));

// --- Movimientos ---
app.post('/api/movimientos', (req, res) => {
  const { fecha, septima, gastos, comentario, gastosItems } = req.body || {};
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
  DB.seq.mov += 1;
  const mov = { id: DB.seq.mov, fecha, septima: num(septima), gastos: num(gastos), comentario: comentario || '' };
  const items = parseGastosItems(gastosItems);
  if (items && items.length) {
    mov.gastosItems = items;
    mov.gastos = items.reduce((a, it) => a + num(it.monto), 0);
  }
  // Insertar manteniendo orden cronológico por fecha
  const idx = DB.movimientos.findIndex((m) => (m.fecha || '') > fecha);
  if (idx === -1) DB.movimientos.push(mov);
  else DB.movimientos.splice(idx, 0, mov);
  save();
  res.json(computeState());
});

app.put('/api/movimientos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const m = DB.movimientos.find((x) => x.id === id);
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  const { fecha, septima, gastos, comentario, gastosItems } = req.body || {};
  if (fecha !== undefined) m.fecha = fecha;
  if (septima !== undefined) m.septima = num(septima);
  if (comentario !== undefined) m.comentario = comentario;
  if (gastosItems !== undefined) {
    const items = parseGastosItems(gastosItems);
    if (items && items.length) {
      m.gastosItems = items;
      m.gastos = items.reduce((a, it) => a + num(it.monto), 0);
    } else {
      delete m.gastosItems;
      m.gastos = gastos !== undefined ? num(gastos) : 0;
    }
  } else if (gastos !== undefined) {
    m.gastos = num(gastos);
    delete m.gastosItems;
  }
  DB.movimientos.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  save();
  res.json(computeState());
});

app.delete('/api/movimientos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  DB.movimientos = DB.movimientos.filter((x) => x.id !== id);
  save();
  res.json(computeState());
});

// --- Aportación clima ---
app.post('/api/clima', (req, res) => {
  const { nombre, monto } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  DB.seq.clima += 1;
  DB.clima.push({ id: DB.seq.clima, nombre, monto: num(monto) });
  save();
  res.json(computeState());
});

app.put('/api/clima/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = DB.clima.find((x) => x.id === id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, monto } = req.body || {};
  if (nombre !== undefined) c.nombre = nombre;
  if (monto !== undefined) c.monto = num(monto);
  save();
  res.json(computeState());
});

app.delete('/api/clima/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  DB.clima = DB.clima.filter((x) => x.id !== id);
  save();
  res.json(computeState());
});

// --- Reserva ---
app.post('/api/reserva', (req, res) => {
  const { mes, monto, comentario } = req.body || {};
  DB.seq.reserva += 1;
  DB.reserva.push({ id: DB.seq.reserva, mes: mes || '', monto: num(monto), comentario: comentario || '' });
  save();
  res.json(computeState());
});

app.put('/api/reserva/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = DB.reserva.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  const { mes, monto, comentario } = req.body || {};
  if (mes !== undefined) r.mes = mes;
  if (monto !== undefined) r.monto = num(monto);
  if (comentario !== undefined) r.comentario = comentario;
  save();
  res.json(computeState());
});

app.delete('/api/reserva/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  DB.reserva = DB.reserva.filter((x) => x.id !== id);
  save();
  res.json(computeState());
});

// --- Promejora (saldo independiente: ingresos y gastos por concepto) ---
app.post('/api/promejora', (req, res) => {
  const { fecha, ingreso, gasto, comentario, gastosItems } = req.body || {};
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
  DB.seq.promejora += 1;
  const p = { id: DB.seq.promejora, fecha, ingreso: num(ingreso), gasto: num(gasto), comentario: comentario || '' };
  const items = parseGastosItems(gastosItems);
  if (items && items.length) {
    p.gastosItems = items;
    p.gasto = items.reduce((a, it) => a + num(it.monto), 0);
  }
  DB.promejora.push(p);
  save();
  res.json(computeState());
});

app.put('/api/promejora/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const p = DB.promejora.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { fecha, ingreso, gasto, comentario, gastosItems } = req.body || {};
  if (fecha !== undefined) p.fecha = fecha;
  if (ingreso !== undefined) p.ingreso = num(ingreso);
  if (comentario !== undefined) p.comentario = comentario;
  if (gastosItems !== undefined) {
    const items = parseGastosItems(gastosItems);
    if (items && items.length) {
      p.gastosItems = items;
      p.gasto = items.reduce((a, it) => a + num(it.monto), 0);
    } else {
      delete p.gastosItems;
      p.gasto = gasto !== undefined ? num(gasto) : 0;
    }
  } else if (gasto !== undefined) {
    p.gasto = num(gasto);
    delete p.gastosItems;
  }
  save();
  res.json(computeState());
});

app.delete('/api/promejora/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  DB.promejora = DB.promejora.filter((x) => x.id !== id);
  save();
  res.json(computeState());
});

// --- Configuración (saldo inicial) ---
app.put('/api/config', (req, res) => {
  const { saldoInicial } = req.body || {};
  if (saldoInicial !== undefined) DB.saldoInicial = num(saldoInicial);
  save();
  res.json(computeState());
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Descargar un respaldo de la base actual (para guardarlo en el celular/PC).
app.get('/api/backup', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bill-w-${stamp}.json"`);
  res.send(fs.readFileSync(DB_FILE, 'utf-8'));
});

// Respaldo automático: uno al arrancar y luego cada 24 h.
makeBackup();
setInterval(makeBackup, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`CRM Grupo Bill W escuchando en puerto ${PORT}`);
  console.log(`Datos en: ${DB_FILE}`);
  console.log(`Respaldos en: ${BACKUP_DIR} (conservando ${BACKUP_KEEP})`);
});
