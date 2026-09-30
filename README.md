# Odoo Compras 🚀

Aplicación web moderna para procesar e ingresar automáticamente órdenes de compra al sistema ERP Odoo a partir de documentos digitalizados (formatos **PDF** y **Word .docx**), permitiendo la verificación e inserción automática de productos faltantes en el inventario.

Construido utilizando **Node.js (Express)** en el backend y **React (Vite + Tailwind CSS v3)** en el frontend.

---

## 🎨 Características

* **Inicio de Sesión Seguro:** Acceso utilizando directamente el correo y la contraseña de Odoo del usuario (la URL y Base de Datos del servidor Odoo se manejan de manera privada en el backend).
* **Modo Claro / Oscuro Inteligente:** Interfaz moderna e inmersiva adaptada a las preferencias estéticas del usuario, con persistencia automática de la configuración.
* **Procesamiento de Documentos:**
  - Extrae de manera secuencial los metadatos (número de orden/presupuesto, fecha de documento, obra/referencia, cliente y dirección).
  - Parsea las tablas de artículos abstrayendo cantidades, unidades de medida, precios unitarios y detalles del producto.
  - Detecta automáticamente el formato del PDF (ver [Formatos de documento soportados](#-formatos-de-documento-soportados)).
  - El precio unitario del documento se usa como precio de costo de cada línea.
* **Integración con CRM:**
  - Lista solo las oportunidades del CRM de Odoo en etapa **ganada** (`stage_id.is_won`), con búsqueda por nombre o cliente y filtro opcional de "solo con adjuntos PDF/DOCX".
  - Descarga y procesa el adjunto seleccionado directamente desde Odoo, sin subirlo manualmente.
  - La cotización creada queda vinculada a la oportunidad: nombre de la oportunidad como *Documento origen*, copia del adjunto en la cotización y nota en el chatter de ambos registros.
  - Las oportunidades que ya tienen órdenes de compra (no canceladas) con su nombre como *Documento origen* se marcan como **"Ya procesada: P000XX"**, con enlace a cada orden, y se muestra un aviso al procesarlas de nuevo para evitar duplicados. Siguen disponibles por si se necesita otra orden (por ejemplo, para otro proveedor).
* **Integración inteligente con Odoo:**
  - **Identificación de Proveedor:** Identifica el proveedor y lo asocia automáticamente o permite buscar/seleccionar de una lista desplegable conectada a Odoo en tiempo real.
  - **Verificación de Catálogo de Inventario:** Valida de forma automática qué productos de la orden ya existen en Odoo y cuáles son nuevos.
  - **Creación en Caliente de Productos:** Permite definir códigos/SKU internos y precios de costo para los productos que no existen y crearlos automáticamente en el catálogo de Odoo.
  - **Registro de la Orden de Compra:** Crea la orden de compra directamente en Odoo en estado borrador (*draft*) con todos los productos y cantidades asociados, y ofrece un enlace para abrirla en Odoo.
  - **Fechas:** Acepta fechas del documento en formato `DD/MM/AAAA`, `DD-MM-AAAA` o `D.M.AAAA`.
* **Consola de Eventos:** Terminal interactiva para monitorear en tiempo real el progreso de cada acción y API.

---

## 📄 Formatos de Documento Soportados

`pdf-parser.js` identifica el formato por su contenido y aplica el lector correspondiente:

| Formato | Cómo se reconoce | Qué extrae |
|---|---|---|
| **Orden de compra** | Tabla con encabezado `Cant. U/M Detalle` | N° de orden, proveedor (`Señores`), fecha, obra, dirección y artículos |
| **Presupuesto (Pos: V1)** | Bloques `Pos: V1 Medidas: …` y tabla `Importe /Uds · Unidades · TOTAL` | N° (`Número:`), fecha, referencia, cliente (`Estimado …`), artículos con precio, posición y medidas |
| **Presupuesto (Pos. 1 - V1)** | Bloques `Pos. N - V1` cerrados por `UDS: cant  precio  total` | N° (`PRESUPUESTO 2026/30/1`), fecha, obra, cliente, artículos (descripción armada con tipo, color, medidas, perfil y vidrio) |
| **Presupuesto (viñetas ⦁)** | Líneas `V1 1 748.538 CLP$ 748.538 CLP$` y encabezado `TIPO UDS VALOR NETO` | N° (`PRESUPUESTO Nº`), fecha, cliente (`OBRA:`), artículos (descripción con tipo, serie, color, medida y cristal) |

Los archivos Word (`.docx`) se procesan con `docx-parser.js`.

> ⚠️ En los presupuestos el único nombre disponible es el del **cliente**, por lo que aparece como "Proveedor detectado". Antes de importar, seleccione el proveedor real en el selector "Asociar a Proveedor Odoo".

Para agregar un formato nuevo, cree una función `parseQuoteFormat…(lines, text)` en `pdf-parser.js` y agregue su condición de detección en `parsePdf`.

---

## 🛠️ Requisitos de Instalación

1. Tener instalado [Node.js](https://nodejs.org/) (versión 18 o superior recomendada).
2. Tener un servidor ERP de Odoo configurado y accesible, con los módulos **Compras** y **CRM** instalados.
3. En Odoo, la etapa "Ganado" del CRM debe tener marcada la opción **"¿Es la etapa ganada?"** para que sus oportunidades aparezcan en la app.
4. El usuario de Odoo necesita permisos de lectura sobre oportunidades del CRM y sus adjuntos.

---

## ⚙️ Configuración del Servidor

En la raíz del proyecto, debes configurar un archivo `.env` o `.env.local` con las variables de conexión a tu servidor Odoo.

Ejemplo de contenido para `.env.local`:
```env
PORT=5000
ODOO_URL=https://tu-empresa.odoo.com
ODOO_DB=tu-base-de-datos
```

> 💡 **Nota:** La aplicación utiliza el protocolo JSON-RPC estándar de Odoo en el puerto HTTPS correspondiente.

---

## 🚀 Cómo Iniciar el Proyecto

### 1. Descargar y compilar (Instalación Inicial)
En la raíz del proyecto, ejecuta el siguiente comando para instalar las dependencias tanto del backend como del frontend, y compilar la aplicación React:
```bash
npm run build
```

### 2. Iniciar el Servidor de Producción
Para iniciar el backend y servir el portal web al mismo tiempo:
```bash
npm start
```
La aplicación se levantará en el puerto configurado en `PORT` (por defecto: `http://localhost:5000`). El frontend compilado usa rutas relativas (`/api`), por lo que funciona con cualquier puerto.

### Modo desarrollo del frontend (opcional)
Con `npm run dev --prefix frontend` (Vite), el frontend apunta a `http://localhost:5000/api`, por lo que en ese caso el backend debe correr en el puerto `5000`.

---

## 📂 Estructura del Código

* `server.js`: Punto de entrada del backend de Express, encargado de servir el frontend e interactuar con la API.
* `odoo-client.js`: Cliente JSON-RPC personalizado para la integración nativa y sin dependencias pesadas con Odoo (incluye copia de adjuntos y notas en el chatter).
* `docx-parser.js` & `pdf-parser.js`: Algoritmos de lectura y extracción heurística de texto y tablas (ver formatos soportados).
* `frontend/`: Aplicación frontend en React utilizando Tailwind CSS.
  - `frontend/src/App.jsx`: Componente principal con el flujo de selección (CRM o archivo), previsualización, edición e importación a Odoo.
  - `frontend/src/index.css`: Hoja de estilos premium con soporte para modo Claro/Oscuro dinámico.

### Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servidor y variables configuradas |
| POST | `/api/odoo/connect` | Inicio de sesión en Odoo |
| POST | `/api/odoo/partners` | Búsqueda de proveedores |
| POST | `/api/odoo/crm/leads` | Oportunidades ganadas del CRM con sus adjuntos PDF/DOCX |
| POST | `/api/odoo/crm/parse-attachment` | Descarga un adjunto del CRM desde Odoo y lo procesa |
| POST | `/api/upload` | Procesa un archivo PDF/DOCX subido manualmente |
| POST | `/api/odoo/verify-products` | Verifica qué productos existen en Odoo |
| POST | `/api/odoo/create-products` | Crea los productos faltantes |
| POST | `/api/odoo/create-purchase-order` | Crea la orden de compra (y la vincula a la oportunidad si viene del CRM) |

---

## 🔒 Licencia
Este proyecto es software privado de uso exclusivo para automatización de compras.
