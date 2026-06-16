# CRM Contabilidad · Grupo Bill W

Aplicación web de contabilidad para **Grupo Bill W**. Sin usuarios ni contraseñas
(la información es pública). Pensada para alojarse en **EasyPanel** con un solo contenedor.

## Qué incluye

- **Panel lateral izquierdo** con navegación entre vistas.
- **Resumen general (ejecutivo):** saldo actual, total séptimas, total gastos, reserva, clima, promejora.
- **Resúmenes por mes (ejecutivos):** ingresos, gastos y saldo de fin de mes; con detalle desplegable.
- **Movimientos:** fecha, séptima (ingreso), gastos y comentarios del concepto. El **saldo corrido se calcula solo**.
- **Reserva:** fondo que se desprende del saldo final de cada mes.
- **Aportación clima:** fondo **independiente** del saldo general, solo con *monto* y *nombre*.
- **Datos precargados** desde el Excel original (`data/seed.json`). No hay que volver a capturarlos.

Saldo inicial `$383.50` · saldo actual `$1,549.00` · gastos `$13,292.00` (idéntico a la hoja original).

## Persistencia

Los datos se guardan en `DATA_DIR/db.json` (por defecto `/data/db.json`).
La primera vez que arranca, si no existe la base, se crea a partir de `data/seed.json`.
**Monte un volumen en `/data`** para que los cambios sobrevivan a los reinicios.

## Desplegar en EasyPanel

1. Suba este proyecto a un repositorio Git (o use la opción de subir código).
2. En EasyPanel: **Create → App**.
3. Origen: el repositorio. EasyPanel detecta el `Dockerfile` automáticamente.
4. **Puerto interno:** `3000`.
5. En **Mounts / Volumes** agregue un volumen persistente montado en `/data`.
6. Deploy. Asigne el dominio y listo.

> El contenedor expone el puerto `3000`. EasyPanel se encarga del HTTPS y el dominio.

## Ejecutar en local

```bash
npm install
npm start
# abrir http://localhost:3000
```

Variables de entorno:

- `PORT` — puerto (por defecto `3000`).
- `DATA_DIR` — carpeta de datos (por defecto `/data` en Docker, `./data` en local).

## Reiniciar los datos

Borre `db.json` del volumen y reinicie: se regenerará desde `data/seed.json`.
