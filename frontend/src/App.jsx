import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  UploadCloud, 
  Settings, 
  Database, 
  FileText, 
  Plus, 
  RefreshCw, 
  Search, 
  ArrowRight, 
  Trash2, 
  Terminal, 
  ExternalLink, 
  Check, 
  AlertTriangle,
  Sun,
  Moon
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000/api';

export default function App() {
  // Theme State (Default to dark)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Login / Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Odoo credentials (only email + password, URL/DB are in server .env.local)
  const [odooEmail, setOdooEmail] = useState('');
  const [odooPass, setOdooPass] = useState('');
  const [odooDb, setOdooDb] = useState('');
  const [odooUrl, setOdooUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // Partners state
  const [odooPartners, setOdooPartners] = useState([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');

  // File Upload State
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  
  // Parsed Order Data
  const [orderData, setOrderData] = useState(null);
  
  // Verification & Sync state
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [verifiedItems, setVerifiedItems] = useState([]);
  const [poResult, setPoResult] = useState(null);

  // App logs
  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
    setTimeout(() => {
      const consoleElem = document.getElementById('log-console');
      if (consoleElem) consoleElem.scrollTop = consoleElem.scrollHeight;
    }, 100);
  };

  const getOdooCredentialsObj = () => ({
    email: odooEmail,
    password: odooPass
  });

  const testOdooConnection = async (e) => {
    if (e) e.preventDefault();
    setConnectionStatus('connecting');
    setLoginError('');

    try {
      const response = await fetch(`${API_BASE_URL}/odoo/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj()
        })
      });

      const data = await response.json();
      if (data.success) {
        setOdooDb(data.db || '');
        setOdooUrl(data.url || '');
        setConnectionStatus('connected');
        setIsLoggedIn(true);
        addLog(`Conectado a Odoo correctamente. UID: ${data.uid}`, 'success');
        fetchPartners();
      } else {
        setConnectionStatus('error');
        setLoginError(data.message || 'Correo o contraseña incorrectos.');
      }
    } catch (error) {
      setConnectionStatus('error');
      setLoginError('No se pudo conectar al servidor. ¿Está corriendo el backend?');
    }
  };

  const fetchPartners = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/odoo/partners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          search: partnerSearch
        })
      });
      const data = await response.json();
      if (data.success) {
        setOdooPartners(data.partners);
        addLog(`Cargados ${data.partners.length} proveedores desde Odoo.`, 'info');
      }
    } catch (error) {
      console.error('Error fetching partners:', error);
    }
  };

  // Trigger search when search text changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const delayDebounce = setTimeout(() => {
        fetchPartners();
      }, 500);
      return () => clearTimeout(delayDebounce);
    }
  }, [partnerSearch, connectionStatus]);

  // Drag & drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (selectedFile) => {
    const ext = selectedFile.name.split('.').pop().toLowerCase();
    if (ext !== 'pdf' && ext !== 'docx') {
      addLog('Archivo no compatible. Suba un documento PDF o DOCX.', 'error');
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);
    setOrderData(null);
    setVerifiedItems([]);
    setPoResult(null);
    addLog(`Procesando archivo: ${selectedFile.name}...`, 'info');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        const order = data.data;
        setOrderData(order);
        addLog(`Archivo parsed con éxito. Proveedor: ${order.supplier}, N° Orden: ${order.orderNumber || 'S/N'}`, 'success');
        addLog(`Encontrados ${order.items?.length || 0} productos en el documento.`, 'info');

        // Automatically match vendor name if found in Odoo partners list
        if (connectionStatus === 'connected') {
          verifyProductsInOdoo(order.items);
        } else {
          // Put in verified state but marked as unverified until connection established
          setVerifiedItems(order.items.map(item => ({
            ...item,
            exists: false,
            odooProduct: null,
            standard_price: 0,
            list_price: 0,
            default_code: '',
            type: 'product',
            createInOdoo: true
          })));
        }
      } else {
        addLog(`Error al parsear el archivo: ${data.message}`, 'error');
        setFile(null);
      }
    } catch (error) {
      addLog(`Error de red al parsear archivo: ${error.message}`, 'error');
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const verifyProductsInOdoo = async (itemsToVerify) => {
    setIsVerifying(true);
    addLog('Verificando productos en el inventario de Odoo...', 'info');

    const itemsList = itemsToVerify || orderData.items;

    try {
      const response = await fetch(`${API_BASE_URL}/odoo/verify-products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          items: itemsList
        })
      });

      const data = await response.json();
      if (data.success) {
        // Enriched with form controls for creating products
        const enriched = data.items.map(item => {
          const words = item.description.replace(/[^a-zA-Z0-9\s]/g, '').split(' ');
          // Generate a candidate SKU/default_code (e.g. first letters or words)
          let generatedCode = '';
          const codeWord = words.find(w => w.match(/\d+/) && w.length >= 4); // Find numbers like SKU
          if (codeWord) {
            generatedCode = codeWord;
          } else {
            generatedCode = words.slice(0, 3).map(w => w.substring(0,3).toUpperCase()).join('-');
          }

          return {
            ...item,
            default_code: item.odooProduct?.default_code || generatedCode,
            standard_price: item.odooProduct?.standard_price || 0.0,
            list_price: item.odooProduct?.list_price || 0.0,
            type: item.odooProduct?.type || 'product', // product = storable
            createInOdoo: !item.exists // Auto-check if doesn't exist
          };
        });

        setVerifiedItems(enriched);
        addLog('Verificación de productos completada.', 'success');
        
        // Count exist/missing
        const existCount = enriched.filter(i => i.exists).length;
        const missingCount = enriched.length - existCount;
        addLog(`Productos en Odoo: ${existCount}. Faltantes: ${missingCount}.`, 'info');
      } else {
        addLog(`Error al verificar productos: ${data.message}`, 'error');
      }
    } catch (error) {
      addLog(`Error de red al verificar productos: ${error.message}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleItemFieldChange = (index, field, value) => {
    const updated = [...verifiedItems];
    updated[index][field] = value;
    setVerifiedItems(updated);
  };

  const importPurchaseOrder = async () => {
    if (connectionStatus !== 'connected') {
      addLog('Por favor conéctese a Odoo antes de importar la orden.', 'error');
      alert('Debe conectarse a Odoo primero.');
      return;
    }

    setIsSyncing(true);
    addLog('Iniciando proceso de importación a Odoo...', 'info');

    try {
      // 1. Identify missing products that are checked for creation
      const itemsToCreate = verifiedItems.filter(item => !item.exists && item.createInOdoo);
      
      let createdCount = 0;
      const productMapping = {}; // maps description to product ID

      if (itemsToCreate.length > 0) {
        addLog(`Creando ${itemsToCreate.length} nuevos productos en el catálogo de Odoo...`, 'info');
        
        const responseCreate = await fetch(`${API_BASE_URL}/odoo/create-products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            odooCredentials: getOdooCredentialsObj(),
            products: itemsToCreate.map((item, index) => ({
              temporaryId: index,
              name: item.description,
              default_code: item.default_code,
              standard_price: item.standard_price,
              list_price: item.list_price,
              type: item.type
            }))
          })
        });

        const dataCreate = await responseCreate.json();
        
        if (dataCreate.success) {
          createdCount = dataCreate.products.length;
          addLog(`Se crearon ${createdCount} productos correctamente en Odoo.`, 'success');
          
          // Add newly created products to the mapping
          dataCreate.products.forEach(prod => {
            productMapping[prod.name] = prod.id;
            addLog(`Producto: ${prod.name} -> ID Odoo: ${prod.id}`, 'info');
          });
        } else {
          throw new Error(`Error en creación de productos: ${dataCreate.message}`);
        }
      }

      // Map verified products IDs
      const finalPoLines = verifiedItems.map(item => {
        let productId = null;
        if (item.exists) {
          productId = item.odooProduct.id;
        } else if (item.createInOdoo && productMapping[item.description]) {
          productId = productMapping[item.description];
        }

        if (!productId) {
          addLog(`ADVERTENCIA: El producto "${item.description}" no se asociará correctamente porque no se creó ni se seleccionó.`, 'warning');
        }

        return {
          productId,
          qty: item.qty,
          priceUnit: item.standard_price || 0.0, // Purchase price is standard_price / cost
          description: item.description
        };
      }).filter(line => line.productId !== null);

      if (finalPoLines.length === 0) {
        throw new Error('No hay productos válidos asociados para crear la orden de compra.');
      }

      // 2. Create the Purchase Order
      addLog(`Creando Orden de Compra en Odoo para el proveedor "${orderData.supplier}"...`, 'info');
      const responsePo = await fetch(`${API_BASE_URL}/odoo/create-purchase-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          supplierName: orderData.supplier,
          items: finalPoLines,
          orderDate: orderData.date,
          orderNumber: orderData.orderNumber
        })
      });

      const dataPo = await responsePo.json();
      if (dataPo.success) {
        setPoResult(dataPo);
        addLog(`¡ÉXITO! Orden de compra ${dataPo.purchaseOrder.name} registrada en Odoo.`, 'success');
        addLog(`Proveedor asociado: ${dataPo.partner.name} (ID: ${dataPo.partner.id})`, 'info');
        alert(`Orden de compra ${dataPo.purchaseOrder.name} creada correctamente.`);
      } else {
        throw new Error(dataPo.message);
      }

    } catch (error) {
      addLog(`Error al importar a Odoo: ${error.message}`, 'error');
      alert(`Error al importar: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setConnectionStatus('disconnected');
    setOrderData(null);
    setVerifiedItems([]);
    setPoResult(null);
    setFile(null);
    setLogs([]);
  };

  // ─── LOGIN SCREEN ─────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {/* Theme Toggle Button */}
        <div className="absolute top-6 right-6 z-20">
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-500/40 transition-all duration-200 shadow-md backdrop-blur-md"
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        {/* Background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-purple-900/20 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-indigo-900/20 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center bg-gradient-to-br from-purple-600 to-indigo-700 text-white w-16 h-16 rounded-2xl text-2xl font-black shadow-2xl shadow-purple-900/40 mb-4">
              Od
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Odoo Purchase Porter
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Ingreso automático de órdenes de compra e inventario
            </p>
          </div>

          {/* Login Form */}
          <div className="glass-panel rounded-2xl p-8 shadow-2xl">
            <div className="flex items-center space-x-2 mb-6 border-b border-slate-800 pb-4">
              <Database className="h-5 w-5 text-purple-400" />
              <h2 className="text-lg font-bold text-white">Iniciar Sesión en Odoo</h2>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-rose-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-rose-300">{loginError}</p>
              </div>
            )}

            <form onSubmit={testOdooConnection} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Email / Usuario</label>
                <input
                  type="text"
                  value={odooEmail}
                  onChange={(e) => setOdooEmail(e.target.value)}
                  placeholder="cristian3877@gmail.com"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Contraseña</label>
                <input
                  type="password"
                  value={odooPass}
                  onChange={(e) => setOdooPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={connectionStatus === 'connecting'}
                className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-sm transition-all transform active:scale-95 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-purple-900/30 mt-2"
              >
                {connectionStatus === 'connecting' ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4" />
                    <span>Conectando...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    <span>Iniciar Sesión</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-[10px] text-slate-600 mt-6">
            Las credenciales se almacenan localmente en el servidor (.env.local)
          </p>
        </div>
      </div>
    );
  }

  // ─── MAIN APP (after login) ───────────────────────────────────────────
  return (
    <div className="min-h-screen pb-12">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 sticky top-0 z-10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-odoo text-white p-2 rounded-lg font-bold shadow-lg shadow-purple-900/30">
              Od
            </div>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                Odoo Purchase Porter <span className="text-xs bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-normal">v1.0</span>
              </h1>
              <p className="text-xs text-slate-400">Conectado como <span className="text-purple-400 font-semibold">{odooEmail}</span> en <span className="text-purple-400 font-semibold">{odooDb}</span></p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Connection Status Badge */}
            <div className="flex items-center space-x-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium text-slate-300">Odoo Conectado</span>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-purple-450 transition-colors"
              title={theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="text-xs text-slate-500 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors font-semibold"
            >
              Cerrar Sesión
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: File Upload */}
        <div className="lg:col-span-4 space-y-6">
          

          {/* Document Upload */}
          <section className="glass-panel rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-2 mb-4 border-b border-slate-800 pb-3">
              <UploadCloud className="h-5 w-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Subir Orden de Compra</h2>
            </div>
            
            <div 
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                dragActive ? 'border-purple-500 bg-purple-500/10' : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
              }`}
            >
              <UploadCloud className="h-10 w-10 text-slate-500 mb-3 animate-pulse-subtle" />
              <p className="text-sm font-medium text-slate-300 text-center">
                Arrastre y suelte su orden de compra aquí
              </p>
              <p className="text-xs text-slate-500 mt-1 text-center">
                Formatos soportados: PDF o Word (.docx)
              </p>
              
              <div className="relative mt-4">
                <input 
                  type="file" 
                  onChange={handleFileChange}
                  accept=".pdf,.docx"
                  className="hidden" 
                  id="file-upload-input"
                />
                <label 
                  htmlFor="file-upload-input"
                  className="bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold py-2 px-4 rounded-lg cursor-pointer transition-colors block"
                >
                  Examinar archivos
                </label>
              </div>
            </div>

            {/* Selected File Details */}
            {file && (
              <div className="mt-4 p-3 bg-slate-950/80 border border-slate-850 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <FileText className="h-8 w-8 text-indigo-400 flex-shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-xs font-semibold text-slate-200 truncate">{file.name}</p>
                    <p className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                {isParsing ? (
                  <Loader2 className="animate-spin h-5 w-5 text-indigo-400 flex-shrink-0" />
                ) : (
                  <button 
                    onClick={() => { setFile(null); setOrderData(null); }}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Parsed Data Viewer & Sync */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Order Details and Sync Panel */}
          {orderData ? (
            <div className="space-y-6">
              
              {/* Metadata Panel */}
              <section className="glass-panel rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">Detalles de la Orden</h3>
                    <p className="text-xs text-slate-400">Verifique los datos y asocie los productos con Odoo</p>
                  </div>
                  {connectionStatus === 'connected' && (
                    <button
                      onClick={() => verifyProductsInOdoo()}
                      disabled={isVerifying}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 text-slate-300 font-semibold py-1.5 px-3 rounded-lg text-xs flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
                    >
                      {isVerifying ? (
                        <Loader2 className="animate-spin h-3 w-3" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      <span>Volver a verificar</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">N° de Orden</label>
                    <input 
                      type="text"
                      value={orderData.orderNumber}
                      onChange={(e) => setOrderData({...orderData, orderNumber: e.target.value})}
                      className="w-full bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Fecha Documento</label>
                    <input 
                      type="text"
                      value={orderData.date}
                      onChange={(e) => setOrderData({...orderData, date: e.target.value})}
                      className="w-full bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Obra / Referencia</label>
                    <input 
                      type="text"
                      value={orderData.reference}
                      onChange={(e) => setOrderData({...orderData, reference: e.target.value})}
                      className="w-full bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* Vendor / Supplier Matching */}
                <div className="mt-6 p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-sm font-bold text-slate-300">Proveedor Detectado:</h4>
                      <span className="bg-purple-900/40 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-800/40 font-semibold">{orderData.supplier}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Si el proveedor no existe en Odoo, la aplicación lo creará automáticamente con este nombre.
                    </p>
                  </div>
                  
                  {connectionStatus === 'connected' ? (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Asociar a Proveedor Odoo (Opcional)</label>
                      <select 
                        className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                        value={selectedPartnerId}
                        onChange={(e) => {
                          setSelectedPartnerId(e.target.value);
                          if (e.target.value) {
                            const name = odooPartners.find(p => p.id === parseInt(e.target.value))?.name;
                            if (name) setOrderData({...orderData, supplier: name});
                          }
                        }}
                      >
                        <option value="">-- Autocreación o búsqueda automática --</option>
                        {odooPartners.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center space-x-2 text-amber-400 text-xs">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>Conéctese a Odoo para buscar proveedores existentes en su base de datos.</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Products Table section */}
              <section className="glass-panel rounded-2xl p-6 shadow-xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                  <h3 className="text-lg font-bold text-white">Detalle de Artículos</h3>
                  <span className="text-xs bg-slate-850 text-slate-400 px-2 py-0.5 rounded-full">
                    {verifiedItems.length} artículos
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-bold">
                        <th className="py-2 px-3">Cant.</th>
                        <th className="py-2 px-3">U/M</th>
                        <th className="py-2 px-3">Descripción / Producto</th>
                        <th className="py-2 px-3">Estado Odoo</th>
                        <th className="py-2 px-3">Código/SKU Odoo</th>
                        <th className="py-2 px-3">Precio Costo ($)</th>
                        <th className="py-2 px-3 text-center">Crear</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {verifiedItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/30 transition-colors">
                          <td className="py-3 px-3 font-semibold text-slate-200">{item.qty}</td>
                          <td className="py-3 px-3 text-slate-400">{item.unit}</td>
                          <td className="py-3 px-3 max-w-xs">
                            <p className="font-medium text-slate-200 truncate" title={item.description}>
                              {item.description}
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            {item.exists ? (
                              <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold flex items-center space-x-1 w-max">
                                <Check className="h-3 w-3" />
                                <span>Existe</span>
                              </span>
                            ) : (
                              <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold flex items-center space-x-1 w-max">
                                <Plus className="h-3 w-3" />
                                <span>Nuevo</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <input 
                              type="text" 
                              value={item.default_code} 
                              disabled={item.exists}
                              onChange={(e) => handleItemFieldChange(idx, 'default_code', e.target.value)}
                              placeholder="Ej. REF-001"
                              className="bg-slate-950/80 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-purple-500 disabled:opacity-50 w-24 text-[11px]"
                            />
                          </td>
                          <td className="py-3 px-3">
                            <input 
                              type="number" 
                              value={item.standard_price} 
                              disabled={item.exists}
                              step="any"
                              onChange={(e) => handleItemFieldChange(idx, 'standard_price', parseFloat(e.target.value) || 0)}
                              placeholder="0.00"
                              className="bg-slate-950/80 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-purple-500 disabled:opacity-50 w-20 text-[11px]"
                            />
                          </td>
                          <td className="py-3 px-3 text-center">
                            <input 
                              type="checkbox" 
                              checked={item.createInOdoo}
                              disabled={item.exists}
                              onChange={(e) => handleItemFieldChange(idx, 'createInOdoo', e.target.checked)}
                              className="rounded bg-slate-950 border-slate-800 text-purple-600 focus:ring-0 focus:ring-offset-0 disabled:opacity-40"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Import Buttons */}
                <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
                  <div className="text-xs text-slate-400">
                    {verifiedItems.filter(i => !i.exists && i.createInOdoo).length} productos nuevos serán creados en el inventario.
                  </div>
                  
                  <button
                    onClick={importPurchaseOrder}
                    disabled={isSyncing}
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2 px-6 rounded-xl text-sm transition-all transform active:scale-95 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-emerald-950/30"
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="animate-spin h-4 w-4" />
                        <span>Sincronizando con Odoo...</span>
                      </>
                    ) : (
                      <>
                        <span>Importar Orden a Odoo</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* Sync Result Success Screen */}
              {poResult && (
                <section className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center space-x-3 mb-3 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6 flex-shrink-0" />
                    <h3 className="text-lg font-bold text-white">¡Orden Sincronizada con Éxito!</h3>
                  </div>
                  <p className="text-sm text-slate-300">
                    La orden de compra ha sido creada en Odoo en estado borrador.
                  </p>
                  
                  <div className="mt-4 grid grid-cols-2 gap-4 max-w-md bg-slate-950/60 p-4 border border-slate-850 rounded-xl text-xs">
                    <div>
                      <p className="text-slate-500">ID en base de datos:</p>
                      <p className="font-mono text-slate-300 font-semibold">{poResult.purchaseOrder.id}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Referencia de Odoo:</p>
                      <p className="font-mono text-emerald-400 font-bold">{poResult.purchaseOrder.name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Proveedor registrado:</p>
                      <p className="font-semibold text-slate-300">{poResult.partner.name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Número original doc:</p>
                      <p className="font-semibold text-slate-300">{orderData.orderNumber || 'S/N'}</p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          ) : (
            /* Empty State */
            <div className="glass-panel rounded-2xl p-12 flex flex-col items-center justify-center text-center h-[400px]">
              <FileText className="h-16 w-16 text-slate-700 mb-4 animate-float" />
              <h3 className="text-lg font-bold text-white">Ningún documento seleccionado</h3>
              <p className="text-sm text-slate-400 max-w-sm mt-2">
                Suba una orden de compra en formato PDF o Word (.docx) a la izquierda para extraer automáticamente su contenido y procesarlo.
              </p>
            </div>
          )}

          {/* Logs Console */}
          <section className="glass-panel rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <Terminal className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Consola de Eventos</h3>
              </div>
              <button 
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-semibold uppercase tracking-wider transition-colors"
              >
                Limpiar logs
              </button>
            </div>

            <div 
              id="log-console"
              className="bg-slate-950/80 border border-slate-850 rounded-xl p-4 h-36 font-mono text-xs overflow-y-auto space-y-1.5 scroll-smooth"
            >
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center py-8 italic">Consola lista. Esperando acciones...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex items-start space-x-2 leading-relaxed">
                    <span className="text-slate-600 flex-shrink-0">[{log.timestamp}]</span>
                    <span className={
                      log.type === 'success' ? 'text-emerald-400' :
                      log.type === 'error' ? 'text-rose-400' :
                      log.type === 'warning' ? 'text-amber-400' : 'text-slate-300'
                    }>
                      {log.type === 'success' ? '[ÉXITO] ' :
                       log.type === 'error' ? '[ERROR] ' :
                       log.type === 'warning' ? '[AVISO] ' : '[INFO] '}
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
