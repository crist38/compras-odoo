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
  Moon,
  Briefcase,
  Paperclip,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

// In Vite dev mode the backend runs separately; in production it serves the frontend itself
const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : '/api';

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

  // PVC brands (Odoo CRM/sales tags)
  const [odooBrands, setOdooBrands] = useState([]);
  const [brandSearch, setBrandSearch] = useState('');

  // File Upload State
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  
  // CRM State (document source: opportunity attachments or manual upload)
  const [sourceMode, setSourceMode] = useState('crm');
  const [crmLeads, setCrmLeads] = useState([]);
  const [crmSearch, setCrmSearch] = useState('');
  const [onlyWithAttachments, setOnlyWithAttachments] = useState(true);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [expandedLeadId, setExpandedLeadId] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedAttachment, setSelectedAttachment] = useState(null);

  // Parsed Order Data
  const [orderData, setOrderData] = useState(null);
  
  // Verification & Sync state
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [verifiedItems, setVerifiedItems] = useState([]);
  const [soResult, setSoResult] = useState(null);

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

      let data;
      try {
        data = await response.json();
      } catch {
        // If response is not JSON (e.g. HTML error page), show HTTP status
        setConnectionStatus('error');
        setLoginError(`Error del servidor (HTTP ${response.status}). Verifica las variables de entorno en Vercel.`);
        return;
      }

      if (data.success) {
        setOdooDb(data.db || '');
        setOdooUrl(data.url || '');
        setConnectionStatus('connected');
        setIsLoggedIn(true);
        addLog(`Conectado a Odoo correctamente. UID: ${data.uid}`, 'success');
      } else {
        setConnectionStatus('error');
        setLoginError(data.message || 'Correo o contraseña incorrectos.');
      }
    } catch (error) {
      setConnectionStatus('error');
      setLoginError(`Error de red: ${error.message}. Verifica que el backend esté activo.`);
    }
  };

  const fetchBrands = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/odoo/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          search: brandSearch
        })
      });
      const data = await response.json();
      if (data.success) {
        setOdooBrands(data.brands);
      }
    } catch (error) {
      console.error('Error fetching brands:', error);
    }
  };

  // Trigger search when search text changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const delayDebounce = setTimeout(() => {
        fetchBrands();
      }, 500);
      return () => clearTimeout(delayDebounce);
    }
  }, [brandSearch, connectionStatus]);

  const fetchCrmLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const response = await fetch(`${API_BASE_URL}/odoo/crm/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          search: crmSearch,
          onlyWithAttachments
        })
      });
      const data = await response.json();
      if (data.success) {
        setCrmLeads(data.leads);
        addLog(`Cargadas ${data.leads.length} oportunidades del CRM.`, 'info');
      } else {
        addLog(`Error al cargar oportunidades del CRM: ${data.message}`, 'error');
      }
    } catch (error) {
      addLog(`Error de red al cargar el CRM: ${error.message}`, 'error');
    } finally {
      setIsLoadingLeads(false);
    }
  };

  // Reload CRM opportunities when the search or filter changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      const delayDebounce = setTimeout(() => {
        fetchCrmLeads();
      }, 500);
      return () => clearTimeout(delayDebounce);
    }
  }, [crmSearch, onlyWithAttachments, connectionStatus]);

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

    setFile({ name: selectedFile.name, size: selectedFile.size });
    setSelectedLead(null);
    setSelectedAttachment(null);
    setIsParsing(true);
    setOrderData(null);
    setVerifiedItems([]);
    setSoResult(null);
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
        handleParsedOrder(data.data);
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

  // Download an attachment of a CRM opportunity from Odoo and parse it
  const processCrmAttachment = async (lead, attachment) => {
    setFile({ name: attachment.name, size: attachment.size });
    setSelectedLead(lead);
    setSelectedAttachment(attachment);
    setIsParsing(true);
    setOrderData(null);
    setVerifiedItems([]);
    setSoResult(null);
    addLog(`Procesando adjunto "${attachment.name}" de la oportunidad "${lead.name}"...`, 'info');
    if (lead.quotations?.length > 0) {
      addLog(`Esta oportunidad ya tiene la cotización ${lead.quotations.map(so => so.name).join(', ')}. Solo se permite una cotización por oportunidad: no podrá importarse.`, 'warning');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/odoo/crm/parse-attachment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          attachmentId: attachment.id
        })
      });

      const data = await response.json();
      if (data.success) {
        handleParsedOrder(data.data, lead);
      } else {
        addLog(`Error al parsear el adjunto: ${data.message}`, 'error');
        setFile(null);
        setSelectedAttachment(null);
      }
    } catch (error) {
      addLog(`Error de red al parsear adjunto: ${error.message}`, 'error');
      setFile(null);
      setSelectedAttachment(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleParsedOrder = (order, lead = null) => {
    // Customer: the opportunity's customer wins over the name read from the document
    const customer = (lead?.partner || order.customer || lead?.name || '').trim();
    setOrderData({ ...order, brand: order.brand || '', customer });
    setBrandSearch('');
    addLog(`Documento leído con éxito. Cliente: ${customer || 'S/N'}, N°: ${order.orderNumber || 'S/N'}, Marca de PVC: ${order.brand || 'no detectada (selecciónela)'}.`, 'success');
    addLog(`Encontrados ${order.items?.length || 0} productos en el documento.`, 'info');

    if (connectionStatus === 'connected') {
      verifyProductsInOdoo(order.items);
    } else {
      // Put in verified state but marked as unverified until connection established
      setVerifiedItems(order.items.map(item => ({
        ...item,
        exists: false,
        odooProduct: null,
        standard_price: 0,
        list_price: item.unitPrice || 0,
        default_code: '',
        type: 'product',
        createInOdoo: true
      })));
    }
  };

  const clearSelectedDocument = () => {
    setFile(null);
    setOrderData(null);
    setSelectedLead(null);
    setSelectedAttachment(null);
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
            list_price: item.unitPrice || item.odooProduct?.list_price || 0.0, // sale price: prefer the price in the document
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

  // Quotations already generated for the opportunity being processed (only one is allowed)
  const selectedLeadQuotations = selectedLead
    ? (crmLeads.find(l => l.id === selectedLead.id)?.quotations || selectedLead.quotations || [])
    : [];

  // Reason why the quotation can't be created yet (null when ready)
  const importBlocker = !orderData ? null
    : selectedLeadQuotations.length > 0 && !soResult
      ? `Esta oportunidad ya tiene la cotización ${selectedLeadQuotations.map(so => so.name).join(', ')}. Solo se permite una por oportunidad; cancélela en Odoo para generar otra.`
      : !orderData.customer?.trim()
        ? 'Indique el cliente (arriba) para habilitar la creación de la cotización.'
        : !orderData.brand?.trim()
          ? 'Seleccione la marca de PVC (arriba) para habilitar la creación. Si no existe en Odoo, escríbala en el buscador y use «como marca nueva».'
          : null;

  const importSaleOrder = async () => {
    if (connectionStatus !== 'connected') {
      addLog('Por favor conéctese a Odoo antes de crear la cotización.', 'error');
      alert('Debe conectarse a Odoo primero.');
      return;
    }
    if (importBlocker) {
      addLog(importBlocker, 'error');
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
      const finalLines = verifiedItems.map(item => {
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
          priceUnit: item.list_price || 0.0, // sale price
          description: item.description
        };
      }).filter(line => line.productId !== null);

      if (finalLines.length === 0) {
        throw new Error('No hay productos válidos asociados para crear la cotización.');
      }

      // 2. Create the Sales Quotation
      addLog(`Creando cotización de venta para "${orderData.customer}" (marca de PVC: ${orderData.brand})...`, 'info');
      const responseSo = await fetch(`${API_BASE_URL}/odoo/create-sale-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          odooCredentials: getOdooCredentialsObj(),
          customerName: orderData.customer,
          brandName: orderData.brand,
          items: finalLines,
          orderDate: orderData.date,
          orderNumber: orderData.orderNumber,
          leadId: selectedLead?.id || null,
          attachmentId: selectedAttachment?.id || null
        })
      });

      const dataSo = await responseSo.json();
      if (dataSo.success) {
        setSoResult(dataSo);
        addLog(`¡ÉXITO! Cotización ${dataSo.saleOrder.name} creada en Ventas.`, 'success');
        addLog(`Cliente: ${dataSo.customer.name} · Marca de PVC (etiqueta): ${dataSo.brand.name}`, 'info');
        if (dataSo.lead) {
          addLog(`Vinculada a la oportunidad CRM "${dataSo.lead.name}".`, 'info');
          fetchCrmLeads(); // refresh the "already processed" badges
        }
        fetchBrands();
        (dataSo.warnings || []).forEach(w => addLog(w, 'warning'));
        alert(`Cotización ${dataSo.saleOrder.name} creada correctamente.`);
      } else {
        throw new Error(dataSo.message);
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
    setSoResult(null);
    setFile(null);
    setCrmLeads([]);
    setSelectedLead(null);
    setSelectedAttachment(null);
    setExpandedLeadId(null);
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
              Odoo Compras
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
                Odoo Compras <span className="text-xs bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-normal">v1.0</span>
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
              <FileText className="h-5 w-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-white">Documento de Origen</h2>
            </div>

            {/* Source tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 mb-4 bg-slate-950/60 border border-slate-800 rounded-xl">
              <button
                onClick={() => setSourceMode('crm')}
                className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  sourceMode === 'crm' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Briefcase className="h-3.5 w-3.5" />
                <span>Desde CRM</span>
              </button>
              <button
                onClick={() => setSourceMode('upload')}
                className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  sourceMode === 'upload' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Subir archivo</span>
              </button>
            </div>

            {sourceMode === 'crm' ? (
            <div>
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={crmSearch}
                    onChange={(e) => setCrmSearch(e.target.value)}
                    placeholder="Buscar oportunidad ganada o cliente..."
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <button
                  onClick={fetchCrmLeads}
                  disabled={isLoadingLeads}
                  title="Recargar oportunidades"
                  className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingLeads ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <label className="flex items-center space-x-2 mt-2 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithAttachments}
                  onChange={(e) => setOnlyWithAttachments(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-purple-600 focus:ring-0 focus:ring-offset-0"
                />
                <span>Solo oportunidades con adjuntos PDF/DOCX</span>
              </label>

              <div className="mt-3 max-h-[420px] overflow-y-auto space-y-1.5 pr-1">
                {isLoadingLeads && crmLeads.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-slate-500 text-xs space-x-2">
                    <Loader2 className="animate-spin h-4 w-4" />
                    <span>Cargando CRM...</span>
                  </div>
                ) : crmLeads.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-8">No se encontraron oportunidades ganadas.</p>
                ) : (
                  crmLeads.map(lead => {
                    const isExpanded = expandedLeadId === lead.id;
                    return (
                      <div
                        key={lead.id}
                        className={`border rounded-xl bg-slate-950/40 transition-colors ${
                          selectedLead?.id === lead.id ? 'border-purple-500/60' : 'border-slate-800'
                        }`}
                      >
                        <button
                          onClick={() => setExpandedLeadId(isExpanded ? null : lead.id)}
                          className="w-full flex items-start space-x-2 p-2.5 text-left"
                        >
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-slate-500 mt-0.5 flex-shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-slate-500 mt-0.5 flex-shrink-0" />}
                          <div className="flex-1 overflow-hidden">
                            <p className="text-xs font-semibold text-slate-200 truncate" title={lead.name}>{lead.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {lead.partner || 'Sin cliente'}{lead.stage ? ` · ${lead.stage}` : ''}
                            </p>
                            {lead.quotations?.length > 0 && (
                              <span
                                className="inline-flex items-center space-x-1 mt-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full text-[10px] font-semibold max-w-full"
                                title={lead.quotations.map(po => `${po.name} · ${po.partner}`).join('\n')}
                              >
                                <Check className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">
                                  Ya procesada: {lead.quotations.map(po => po.name).join(', ')}
                                </span>
                              </span>
                            )}
                          </div>
                          <span className="flex items-center space-x-0.5 text-[10px] text-slate-400 flex-shrink-0">
                            <Paperclip className="h-3 w-3" />
                            <span>{lead.attachments.length}</span>
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="px-2.5 pb-2.5 space-y-1">
                            {lead.quotations?.length > 0 && (
                              <div className="ml-6 mb-1.5 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-300 space-y-0.5">
                                <p className="font-semibold">Cotización ya generada:</p>
                                {lead.quotations.map(po => (
                                  <p key={po.id}>
                                    {odooUrl ? (
                                      <a
                                        href={`${odooUrl.replace(/\/$/, '')}/web#id=${po.id}&model=sale.order&view_type=form`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline hover:text-amber-200"
                                      >{po.name}</a>
                                    ) : po.name}
                                    {po.partner ? ` · ${po.partner}` : ''}
                                  </p>
                                ))}
                              </div>
                            )}
                            {lead.attachments.length === 0 ? (
                              <p className="text-[11px] text-slate-500 pl-6">Sin adjuntos PDF/DOCX.</p>
                            ) : (
                              lead.attachments.map(att => (
                                <button
                                  key={att.id}
                                  onClick={() => processCrmAttachment(lead, att)}
                                  disabled={isParsing}
                                  className={`w-full flex items-center space-x-2 pl-6 pr-2 py-1.5 rounded-lg text-left text-[11px] transition-colors disabled:opacity-50 ${
                                    selectedAttachment?.id === att.id
                                      ? 'bg-purple-500/15 text-purple-300'
                                      : 'text-slate-300 hover:bg-slate-900'
                                  }`}
                                >
                                  <FileText className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
                                  <span className="truncate flex-1" title={att.name}>{att.name}</span>
                                  <span className="text-slate-500 flex-shrink-0">{((att.size || 0) / 1024).toFixed(0)} KB</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            ) : (
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
                Arrastre y suelte el presupuesto u orden aquí
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
            )}

            {/* Selected File Details */}
            {file && (
              <div className="mt-4 p-3 bg-slate-950/80 border border-slate-850 rounded-xl flex items-center justify-between">
                <div className="flex items-center space-x-3 overflow-hidden">
                  <FileText className="h-8 w-8 text-indigo-400 flex-shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-xs font-semibold text-slate-200 truncate">{file.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {((file.size || 0) / 1024).toFixed(1)} KB
                      {selectedLead && <> · CRM: <span className="text-purple-400">{selectedLead.name}</span></>}
                    </p>
                  </div>
                </div>
                {isParsing ? (
                  <Loader2 className="animate-spin h-5 w-5 text-indigo-400 flex-shrink-0" />
                ) : (
                  <button
                    onClick={clearSelectedDocument}
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

                {/* Customer and PVC brand (sales tag) */}
                <div className="mt-6 p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Cliente {orderData.customer?.trim() ? '' : '(Obligatorio)'}
                    </label>
                    {selectedLead?.partner ? (
                      <>
                        <p className="w-full bg-slate-950/60 border border-slate-800/80 rounded-lg px-3 py-2 text-sm font-semibold text-white">{selectedLead.partner}</p>
                        <p className="text-xs text-slate-500 mt-1">Cliente de la oportunidad del CRM.</p>
                      </>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={orderData.customer || ''}
                          onChange={(e) => setOrderData({...orderData, customer: e.target.value})}
                          placeholder="Nombre del cliente"
                          className={`w-full bg-slate-950/60 border rounded-lg px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:border-purple-500 ${
                            orderData.customer?.trim() ? 'border-slate-800/80' : 'border-amber-500/60'
                          }`}
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Se busca en Odoo por nombre exacto; si no existe se crea una sola vez{selectedLead ? ' y se asigna a la oportunidad' : ''}.
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Marca de PVC (etiqueta) {orderData.brand?.trim() ? '' : '(Obligatorio)'}
                      </label>
                      {orderData.brand ? (
                        <span className="bg-purple-900/40 text-purple-300 text-xs px-2 py-0.5 rounded-full border border-purple-800/40 font-semibold">{orderData.brand}</span>
                      ) : (
                        <span className="bg-amber-500/10 text-amber-400 text-xs px-2 py-0.5 rounded-full border border-amber-500/20 font-semibold">Sin identificar</span>
                      )}
                    </div>

                    {connectionStatus === 'connected' ? (
                      <>
                        <div className="relative mb-1.5">
                          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={brandSearch}
                            onChange={(e) => setBrandSearch(e.target.value)}
                            placeholder="Buscar marca..."
                            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
                          />
                        </div>
                        <select
                          className={`w-full bg-slate-950/80 border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 ${
                            orderData.brand ? 'border-slate-800' : 'border-amber-500/60'
                          }`}
                          value={odooBrands.find(b => b.name.toLowerCase() === (orderData.brand || '').toLowerCase())?.id || ''}
                          onChange={(e) => {
                            const brand = odooBrands.find(b => b.id === parseInt(e.target.value));
                            setOrderData({...orderData, brand: brand ? brand.name : ''});
                          }}
                        >
                          <option value="">
                            {orderData.brand ? `-- ${orderData.brand} --` : '-- Seleccione la marca --'}
                          </option>
                          {odooBrands.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>

                        {/* Brand typed in the search box that doesn't exist in Odoo yet */}
                        {brandSearch.trim() &&
                          !odooBrands.some(b => b.name.trim().toLowerCase() === brandSearch.trim().toLowerCase()) &&
                          (orderData.brand || '').toLowerCase() !== brandSearch.trim().toLowerCase() && (
                          <button
                            type="button"
                            onClick={() => {
                              setOrderData({...orderData, brand: brandSearch.trim().toUpperCase()});
                              addLog(`Marca de PVC "${brandSearch.trim().toUpperCase()}" seleccionada; se creará como etiqueta en Odoo.`, 'info');
                            }}
                            className="mt-1.5 w-full flex items-center justify-center space-x-1.5 bg-slate-900 hover:bg-slate-800 border border-dashed border-purple-500/50 text-purple-300 text-xs font-semibold py-1.5 rounded-lg transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Usar «{brandSearch.trim().toUpperCase()}» como marca nueva</span>
                          </button>
                        )}
                        <p className="text-xs text-slate-500 mt-1">
                          Queda como etiqueta en la cotización y en la oportunidad (una sola etiqueta por marca).
                        </p>
                      </>
                    ) : (
                      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center space-x-2 text-amber-400 text-xs">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        <span>Conéctese a Odoo para buscar las marcas de PVC existentes.</span>
                      </div>
                    )}
                  </div>
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
                        <th className="py-2 px-3">Precio Venta ($)</th>
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
                              value={item.list_price}
                              step="any"
                              onChange={(e) => handleItemFieldChange(idx, 'list_price', parseFloat(e.target.value) || 0)}
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
                <div className="mt-6 flex items-center justify-between gap-4 border-t border-slate-800 pt-4">
                  {importBlocker ? (
                    <div className="text-xs text-amber-400 flex items-center space-x-1.5">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <span>{importBlocker}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">
                      {verifiedItems.filter(i => !i.exists && i.createInOdoo).length} productos nuevos serán creados en el catálogo.
                    </div>
                  )}

                  <button
                    onClick={importSaleOrder}
                    disabled={isSyncing || !!importBlocker}
                    className="flex-shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2 px-6 rounded-xl text-sm transition-all transform active:scale-95 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-emerald-950/30"
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="animate-spin h-4 w-4" />
                        <span>Creando cotización...</span>
                      </>
                    ) : (
                      <>
                        <span>Crear Cotización en Ventas</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </section>

              {/* Sync Result Success Screen */}
              {soResult && (
                <section className="bg-emerald-950/30 border border-emerald-500/20 rounded-2xl p-6 shadow-xl">
                  <div className="flex items-center space-x-3 mb-3 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6 flex-shrink-0" />
                    <h3 className="text-lg font-bold text-white">¡Cotización creada con éxito!</h3>
                  </div>
                  <p className="text-sm text-slate-300">
                    La cotización ha sido creada en el módulo de Ventas de Odoo en estado borrador.
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-4 max-w-md bg-slate-950/60 p-4 border border-slate-850 rounded-xl text-xs">
                    <div>
                      <p className="text-slate-500">Cotización:</p>
                      <p className="font-mono text-emerald-400 font-bold">{soResult.saleOrder.name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Cliente:</p>
                      <p className="font-semibold text-slate-300">{soResult.customer.name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Marca de PVC (etiqueta):</p>
                      <p className="font-semibold text-slate-300">{soResult.brand.name}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Número original doc:</p>
                      <p className="font-semibold text-slate-300">{orderData.orderNumber || 'S/N'}</p>
                    </div>
                    {soResult.lead && (
                      <div className="col-span-2">
                        <p className="text-slate-500">Oportunidad CRM vinculada:</p>
                        <p className="font-semibold text-purple-400">{soResult.lead.name}</p>
                      </div>
                    )}
                  </div>

                  {odooUrl && (
                    <a
                      href={`${odooUrl.replace(/\/$/, '')}/web#id=${soResult.saleOrder.id}&model=sale.order&view_type=form`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1.5 mt-4 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Abrir cotización en Odoo</span>
                    </a>
                  )}
                </section>
              )}
            </div>
          ) : (
            /* Empty State */
            <div className="glass-panel rounded-2xl p-12 flex flex-col items-center justify-center text-center h-[400px]">
              <FileText className="h-16 w-16 text-slate-700 mb-4 animate-float" />
              <h3 className="text-lg font-bold text-white">Ningún documento seleccionado</h3>
              <p className="text-sm text-slate-400 max-w-sm mt-2">
                Seleccione un adjunto de una oportunidad del CRM, o suba un presupuesto u orden en PDF o Word (.docx), para extraer automáticamente su contenido y procesarlo.
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
