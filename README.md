# CRM Contabilidad · Grupo Bill W

Aplicación web de contabilidad para **Grupo Bill W**, con acceso por palabra secreta (`SECRET_WORD`). Pensada para alojarse en **EasyPanel** con un solo contenedor.

## Qué incluye

- **Panel lateral izquierdo** con navegación entre vistas.
- **Resumen general (ejecutivo):** saldo actual, total séptimas, total gastos y reserva.
- **Resúmenes por mes (ejecutivos):** ingresos, gastos y saldo de fin de mes; con detalle desplegable.
- **Movimientos:** fecha, séptima (ingreso), gastos y comentarios del concepto. El **saldo corrido se calcula solo**.
- **Reserva:** fondo que se desprende del saldo final de cada mes.
- **Séptimas extras:** fondo independiente con fecha, motivo y varios conceptos de ingreso y egreso; totales y saldo acumulado automáticos. Incluye edición, eliminación y filtros por año/mes.
- **Reportes:** Séptimas extras aparece por separado en el resumen anual, en la tabla mensual y en los reportes PDF mensual y por rango de fechas, con saldo anterior, entradas, salidas, conceptos y saldo final. También se incluyen meses que solo tienen actividad de este fondo.
- **Datos precargados** desde el Excel original (`data/seed.json`). No hay que volver a capturarlos.

> Los apartados **Aportación clima** y **Promejora** se retiraron de la aplicación.
> Sus registros siguen guardados en `db.json` (campos `clima` y `promejora`) como
> historial: no se muestran ni se pueden editar, pero tampoco se borran.

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

## Séptimas extras y actualización

Los registros se guardan en `septimasExtras` dentro de la misma base y los mismos respaldos. Al abrir una base anterior se inicializa el fondo vacío y su secuencia de identificadores; los demás fondos y su historial se conservan. No hay que borrar ni regenerar `db.json` al desplegar esta actualización.

Cada registro tiene fecha, motivo, `ingresosItems` y `gastosItems` (listas de concepto y monto). Se admite ingreso, egreso o ambos en la misma fecha. Cada concepto requiere descripción y un monto positivo con máximo dos decimales. El saldo del fondo empieza en cero y se calcula cronológicamente como ingresos menos egresos, sin sumarse al saldo general ni a la reserva.

Para ejecutar las pruebas de cálculo, compatibilidad de bases y contenido de reportes: `npm test` (Node 18 o superior).

