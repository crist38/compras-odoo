# Seguimiento de Proyectos (Odoo) 🚀

Aplicación web que muestra, para cada oportunidad ganada del **CRM de Odoo**, el avance del proyecto en cinco frentes: **Técnico, Financiero, Producción, Despacho e Instalación**. El estado de cada frente se **calcula automáticamente** a partir de los datos de Odoo (cotizaciones, facturas, órdenes de fabricación, entregas y tareas); no se escribe nada en Odoo.

Construido utilizando **Node.js (Express)** en el backend y **React (Vite + Tailwind CSS v3)** en el frontend.

> Reemplaza al antiguo cotizador (lectura de PDF/DOCX → cotización de venta), que sigue disponible en el historial de git hasta el commit `bd8901b`.

---

## 🎨 Características

* **Inicio de sesión** con el correo y la contraseña de Odoo del usuario (URL y base de datos van en el `.env` del servidor).
* **Modo claro / oscuro** con persistencia.
* **Lista de oportunidades** en la etapa ganada del CRM y en las etapas posteriores (por ejemplo *En Fabricación* y *FINALIZADOS*), con búsqueda por nombre o cliente y filtro por etapa. Cada una muestra una mini barra de avance de los cinco frentes.
* **Tablero de la oportunidad**: los cinco frentes con sus etapas, la etapa actual resaltada en color, las anteriores marcadas como cumplidas y una línea que explica de dónde sale el estado. Enlaces a la oportunidad y a sus cotizaciones en Odoo.

---

## 📊 Cómo se calcula cada frente

Las reglas están en `tracking.js`. Las cotizaciones de una oportunidad se encuentran por el campo **Oportunidad** (`opportunity_id`), por el *Documento origen* igual al nombre de la oportunidad, o por un número de pedido escrito en el nombre (ej. `S00572 - Roberto Ramirez`).

| Frente | Etapas | Regla |
|---|---|---|
| **Técnico** | Sin medir › Medido › En revisión › Aprobado › Liberado | Medido: la oportunidad tiene adjuntos. En revisión: cotización en borrador/enviada. Aprobado: pedido confirmado. Liberado: el pedido tiene órdenes de fabricación confirmadas. |
| **Financiero** | Anticipo pendiente › Habilitado › Pago parcial › Saldo › Pagado | Sobre las facturas de cliente publicadas (y pagos en línea) del pedido confirmado. Habilitado: pagado el anticipo (`ADVANCE_RATIO`, 50 %). Pago parcial: pagado más que el anticipo. Saldo: todo facturado y queda saldo por cobrar. Pagado: total cubierto. |
| **Producción** | Sin liberar › Programado › Fabricación › Calidad › Terminado | Órdenes de fabricación del pedido. Programado: confirmadas sin iniciar. Fabricación: alguna en curso u operación de taller hecha. Calidad: todas terminadas, alguna "por cerrar". Terminado: todas hechas. |
| **Despacho** | Pendiente › Programado › Parcial › Completo | Entregas de salida del pedido. Programado: entrega lista (reservada). Parcial: alguna entregada. Completo: todas entregadas. |
| **Instalación** | No aplica › Pendiente › Programada › En ejecución › Recibida | Aplica si el pedido tiene líneas con "instalación" o tareas de proyecto. Programada: tarea con fecha. En ejecución: fecha de inicio ya alcanzada. Recibida: tareas cerradas. |

**Etapa del CRM como mínimo:** si la oportunidad está en una etapa tipo *En Fabricación*, Técnico queda al menos en *Liberado* y Producción en *Fabricación*; en una etapa tipo *FINALIZADOS*, todos los frentes quedan completos (Instalación solo si aplica). Esos casos se marcan con la etiqueta **"según CRM"**.

> ℹ️ Si el usuario no tiene acceso a algún módulo (Contabilidad, Fabricación, Inventario, Proyecto), el tablero se carga igual y muestra un aviso.

---

## 🛠️ Requisitos

1. [Node.js](https://nodejs.org/) 18 o superior.
2. Odoo con **CRM** y **Ventas** (`sale_crm`). Para los demás frentes: **Contabilidad**, **Fabricación**, **Inventario** y **Proyecto**.
3. En Odoo, la etapa "Ganado" del CRM debe tener marcada **"¿Es la etapa ganada?"**. Las etapas posteriores también se muestran, salvo las que parecen de pérdida ("Perdidos", "No califica").

---

## ⚙️ Configuración del Servidor

En la raíz del proyecto, configure un archivo `.env` o `.env.local`:
```env
PORT=5000
ODOO_URL=https://tu-empresa.odoo.com
ODOO_DB=tu-base-de-datos
# Obligatoria, mínimo 32 caracteres aleatorios. Cifra la cookie de sesión; sin ella nadie puede iniciar sesión
SESSION_SECRET=genera_una_cadena_aleatoria_larga
```

En Vercel, defina estas variables en el proyecto. Si cambia `SESSION_SECRET`, todas las sesiones se cierran.

---

## 🚀 Cómo Iniciar el Proyecto

```bash
npm run build
```
```bash
npm start
```
La aplicación se levanta en el puerto `PORT` (por defecto `http://localhost:5000`). Con `npm run dev --prefix frontend` (Vite), el frontend apunta a `http://localhost:5000/api`.

---

## 📂 Estructura del Código

* `server.js`: backend Express; sirve el frontend y la API.
* `tracking.js`: lectura de datos de Odoo y reglas de los cinco frentes.
* `odoo-client.js`: cliente JSON-RPC mínimo para Odoo.
* `frontend/src/App.jsx`: inicio de sesión, lista de oportunidades y tablero.

### Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor y variables configuradas |
| POST | `/api/odoo/connect` | Inicio de sesión en Odoo |
| POST | `/api/odoo/tracking` | Oportunidades ganadas con el estado de sus cinco frentes (`search`, `stageId` opcionales) |

---

## 🔒 Licencia
Software privado de uso exclusivo de la empresa.
