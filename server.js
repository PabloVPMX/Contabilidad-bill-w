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

// Recursos públicos (no sensibles) que el navegador necesita sin sesión:
// logo de la pantalla de acceso, manifiesto, íconos y service worker de la PWA.
const PUBLIC_ASSETS = new Set([
  '/logo.webp',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png'
]);

// A partir de aquí, todo requiere haber ingresado la palabra de acceso.
app.use((req, res, next) => {
  if (isAuthed(req)) return next();
  if (PUBLIC_ASSETS.has(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autorizado' });
  res.status(200).send(loginPage(false));
});

app.use(express.static(path.join(__dirname, 'public'), {
  // Revalidar siempre con el servidor: tras un deploy, el navegador toma la
  // versión nueva de inmediato (con ETag la revalidación es muy ligera).
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

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
      movimientos: (seed.movimientos || []).map((m, i) => ({ id: i + 1, ...m })),
      reserva: (seed.reserva || []).map((r, i) => ({ id: i + 1, ...r })),
      // Fondos descontinuados (clima y promejora): se conservan en la base
      // únicamente como historial; ya no se muestran ni se pueden editar.
      clima: (seed.clima || []).map((c, i) => ({ id: i + 1, ...c })),
      promejora: seed.promejora ?? [],
      seq: { mov: (seed.movimientos || []).length, reserva: (seed.reserva || []).length }
    };
    writeDb(db);
    return db;
  }
  return readDb();
}

// Normaliza bases existentes. Los campos de clima y promejora se dejan
// intactos: no se usan, pero se reescriben tal cual para no perder historial.
function normalizeDb(db) {
  db.seq = db.seq || {};
  // Migración idempotente: conserva el formato anterior como historial.
  if (!Array.isArray(db.colectasExtras)) {
    db.colectasExtras = [];
    for (const r of db.septimasExtras || []) {
      let c = db.colectasExtras.find((c) => c.motivo.trim().toLowerCase() === r.motivo.trim().toLowerCase());
      if (!c) {
        c = { id: db.colectasExtras.length + 1, motivo: r.motivo, meta: 0, estado: 'abierta', movimientos: [], seq: 0 };
        db.colectasExtras.push(c);
      }
      for (const [tipo, items] of [['aportacion', r.ingresosItems || []], ['gasto', r.gastosItems || []]]) {
        for (const it of items) c.movimientos.push({ id: ++c.seq, tipo, fecha: r.fecha,
          ...(tipo === 'aportacion' ? { persona: it.concepto } : { concepto: it.concepto }), monto: it.monto });
      }
    }
  }
  db.seq.colectas = Math.max(Number(db.seq.colectas) || 0, ...db.colectasExtras.map((c) => c.id));
  for (const c of db.colectasExtras) c.seq = Math.max(Number(c.seq) || 0, ...c.movimientos.map((m) => m.id));
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

let DB = normalizeDb(ensureDb());
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
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // Reserva: cada registro puede tener egresos (gastosItems) que restan al
  // fondo. El total es la suma de aportaciones menos esos egresos.
  const reservaEgresos = DB.reserva.reduce((a, r) => a + (gastosItemsTotal(r) || 0), 0);
  const totalReserva = DB.reserva.reduce((a, r) => a + num(r.monto), 0) - reservaEgresos;

  const centsTotal = (rows) => rows.reduce((a, r) => a + Math.round(num(r.monto) * 100), 0) / 100;
  const colectasExtras = DB.colectasExtras.map((c) => {
    const movimientos = [...c.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    const recaudado = centsTotal(movimientos.filter((m) => m.tipo === 'aportacion'));
    const gastado = centsTotal(movimientos.filter((m) => m.tipo === 'gasto'));
    return { ...c, movimientos, recaudado, gastado,
      saldo: Math.round((recaudado - gastado) * 100) / 100,
      faltante: Math.max(0, Math.round((num(c.meta) - recaudado) * 100) / 100) };
  });
  let saldoExtras = 0;
  // Libro cronológico derivado para los resúmenes y reportes existentes.
  const septimasExtras = colectasExtras.flatMap((c) => c.movimientos.map((m) => ({
    id: `${c.id}-${m.id}`, colectaId: c.id, motivo: c.motivo, fecha: m.fecha,
    ingresosItems: m.tipo === 'aportacion' ? [{ concepto: m.persona, monto: m.monto }] : [],
    gastosItems: m.tipo === 'gasto' ? [{ concepto: m.concepto, monto: m.monto }] : []
  }))).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.colectaId - b.colectaId)
    .map((r) => {
      const ingresos = centsTotal(r.ingresosItems), egresos = centsTotal(r.gastosItems);
      const saldoAnterior = saldoExtras;
      saldoExtras = Math.round((saldoExtras + ingresos - egresos) * 100) / 100;
      return { ...r, ingresos, egresos, saldoAnterior, saldo: saldoExtras };
    });

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
      totalSeptimasExtras: saldoExtras,
      numMovimientos: rows.length
    },
    meses,
    reserva: DB.reserva,
    septimasExtras,
    colectasExtras
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

// --- Reserva ---
app.post('/api/reserva', (req, res) => {
  const { mes, monto, comentario, gastosItems } = req.body || {};
  DB.seq.reserva += 1;
  const r = { id: DB.seq.reserva, mes: mes || '', monto: num(monto), comentario: comentario || '' };
  const items = parseGastosItems(gastosItems);
  if (items && items.length) r.gastosItems = items;
  DB.reserva.push(r);
  save();
  res.json(computeState());
});

app.put('/api/reserva/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = DB.reserva.find((x) => x.id === id);
  if (!r) return res.status(404).json({ error: 'No encontrado' });
  const { mes, monto, comentario, gastosItems } = req.body || {};
  if (mes !== undefined) r.mes = mes;
  if (monto !== undefined) r.monto = num(monto);
  if (comentario !== undefined) r.comentario = comentario;
  if (gastosItems !== undefined) {
    const items = parseGastosItems(gastosItems);
    if (items && items.length) r.gastosItems = items;
    else delete r.gastosItems;
  }
  save();
  res.json(computeState());
});

app.delete('/api/reserva/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  DB.reserva = DB.reserva.filter((x) => x.id !== id);
  save();
  res.json(computeState());
});

// --- Colectas de Séptimas extras ---
function fechaValida(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}
function montoValido(value, zero = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0) || !Number.isSafeInteger(Math.round(n * 100)) || Math.abs(n * 100 - Math.round(n * 100)) > 0.000001) {
    throw new Error('El monto debe ser ' + (zero ? 'cero o positivo' : 'positivo') + ', con máximo dos decimales');
  }
  return Math.round(n * 100) / 100;
}
function parseColecta(body) {
  const motivo = String(body?.motivo || '').trim();
  if (!motivo) throw new Error('El motivo es obligatorio');
  const meta = montoValido(body?.meta || 0, true);
  const estado = body?.estado || 'abierta';
  if (!['abierta', 'cerrada'].includes(estado)) throw new Error('Estado inválido');
  return { motivo, meta, estado };
}
function parseAporte(body) {
  if (!fechaValida(body?.fecha)) throw new Error('La fecha es obligatoria y debe ser válida');
  const tipo = body?.tipo;
  if (!['aportacion', 'gasto'].includes(tipo)) throw new Error('Tipo inválido');
  const key = tipo === 'aportacion' ? 'persona' : 'concepto';
  const texto = String(body?.[key] || '').trim();
  if (!texto) throw new Error(tipo === 'aportacion' ? 'El nombre de quien aporta es obligatorio' : 'El concepto del gasto es obligatorio');
  return { fecha: body.fecha, tipo, [key]: texto, monto: montoValido(body.monto) };
}
app.post('/api/colectas', (req, res) => {
  let value;
  try { value = parseColecta(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  DB.colectasExtras.push({ id: ++DB.seq.colectas, ...value, movimientos: [], seq: 0 });
  save(); res.json(computeState());
});
app.put('/api/colectas/:id', (req, res) => {
  const c = DB.colectasExtras.find((c) => c.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Colecta no encontrada' });
  let value;
  try { value = parseColecta(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  Object.assign(c, value); save(); res.json(computeState());
});
app.delete('/api/colectas/:id', (req, res) => {
  const index = DB.colectasExtras.findIndex((c) => c.id === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Colecta no encontrada' });
  if (DB.colectasExtras[index].movimientos.length) return res.status(409).json({ error: 'Esta colecta tiene registros. Puedes cerrarla para conservar su historial.' });
  DB.colectasExtras.splice(index, 1); save(); res.json(computeState());
});
app.post('/api/colectas/:id/movimientos', (req, res) => {
  const c = DB.colectasExtras.find((c) => c.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Colecta no encontrada' });
  if (c.estado === 'cerrada') return res.status(409).json({ error: 'Reabre la colecta antes de agregar registros' });
  let value;
  try { value = parseAporte(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  c.movimientos.push({ id: ++c.seq, ...value }); save(); res.json(computeState());
});
app.put('/api/colectas/:id/movimientos/:movId', (req, res) => {
  const c = DB.colectasExtras.find((c) => c.id === Number(req.params.id));
  const index = c?.movimientos.findIndex((m) => m.id === Number(req.params.movId));
  if (!c || index < 0) return res.status(404).json({ error: 'Registro no encontrado' });
  let value;
  try { value = parseAporte(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  c.movimientos[index] = { id: c.movimientos[index].id, ...value }; save(); res.json(computeState());
});
app.delete('/api/colectas/:id/movimientos/:movId', (req, res) => {
  const c = DB.colectasExtras.find((c) => c.id === Number(req.params.id));
  const index = c?.movimientos.findIndex((m) => m.id === Number(req.params.movId));
  if (!c || index < 0) return res.status(404).json({ error: 'Registro no encontrado' });
  c.movimientos.splice(index, 1); save(); res.json(computeState());
});
// Evita escrituras desde una pestaña con la versión anterior del formulario.
for (const [method, url] of [['post', '/api/septimas-extras'], ['put', '/api/septimas-extras/:id'], ['delete', '/api/septimas-extras/:id']]) {
  app[method](url, (req, res) => res.status(409).json({ error: 'Actualiza la página para usar el nuevo registro por colectas' }));
}

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

