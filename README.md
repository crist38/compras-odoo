# Odoo Compras 🚀

Aplicación web moderna para procesar e ingresar automáticamente órdenes de compra al sistema ERP Odoo a partir de documentos digitalizados (formatos **PDF** y **Word .docx**), permitiendo la verificación e inserción automática de productos faltantes en el inventario.

Construido utilizando **Node.js (Express)** en el backend y **React (Vite + Tailwind CSS v3)** en el frontend.

---

## 🎨 Características

* **Inicio de Sesión Seguro:** Acceso utilizando directamente el correo y la contraseña de Odoo del usuario (la URL y Base de Datos del servidor Odoo se manejan de manera privada en el backend).
* **Modo Claro / Oscuro Inteligente:** Interfaz moderna e inmersiva adaptada a las preferencias estéticas del usuario, con persistencia automática de la configuración.
* **Procesamiento de Documentos:**
  - Extrae de manera secuencial los metadatos (número de orden, fecha de documento, obra/referencia y dirección).
  - Parsea las tablas de artículos abstrayendo cantidades, unidades de medida y detalles del producto.
* **Integración inteligente con Odoo:**
  - **Identificación de Proveedor:** Identifica el proveedor y lo asocia automáticamente o permite buscar/seleccionar de una lista desplegable conectada a Odoo en tiempo real.
  - **Verificación de Catálogo de Inventario:** Valida de forma automática qué productos de la orden ya existen en Odoo y cuáles son nuevos.
  - **Creación en Caliente de Productos:** Permite definir códigos/SKU internos y precios de costo para los productos que no existen y crearlos automáticamente en el catálogo de Odoo.
  - **Registro de la Orden de Compra:** Crea la orden de compra directamente en Odoo en estado borrador (*draft*) con todos los productos y cantidades asociados.
* **Consola de Eventos:** Terminal interactiva para monitorear en tiempo real el progreso de cada acción y API.

---

## 🛠️ Requisitos de Instalación

1. Tener instalado [Node.js](https://nodejs.org/) (versión 18 o superior recomendada).
2. Tener un servidor ERP de Odoo configurado y accesible.

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
La aplicación se levantará en el puerto configurado (por defecto: `http://localhost:5000`).

---

## 📂 Estructura del Código

* `server.js`: Punto de entrada del backend de Express, encargado de servir el frontend e interactuar con la API.
* `odoo-client.js`: Cliente JSON-RPC personalizado para la integración nativa y sin dependencias pesadas con Odoo.
* `docx-parser.js` & `pdf-parser.js`: Algoritmos de lectura y extracción heurística de texto y tablas.
* `frontend/`: Aplicación frontend en React utilizando Tailwind CSS.
  - `frontend/src/App.jsx`: Componente principal con el flujo de carga, previsualización, edición e importación a Odoo.
  - `frontend/src/index.css`: Hoja de estilos premium con soporte para modo Claro/Oscuro dinámico.

---

## 🔒 Licencia
Este proyecto es software privado de uso exclusivo para automatización de compras.
