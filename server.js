const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');
const OdooClient = require('./odoo-client');
// Note: parseDocx and parsePdf are loaded lazily inside the upload endpoint
// to avoid crashing the serverless function if a parser fails to load at startup

// Load environment variables: .env first, then .env.local to override
const envPath = path.join(__dirname, '.env');
const envLocalPath = path.join(__dirname, '.env.local');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: true });
}

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Helper to get OdooClient: URL and DB from env, email/password from request
function getOdooClient(req) {
    const { email, password } = req.body.odooCredentials || {};
    
    const odooUrl = process.env.ODOO_URL;
    const odooDb = process.env.ODOO_DB;

    if (!odooUrl || !odooDb) {
        throw new Error('Falta configurar ODOO_URL y ODOO_DB en el archivo .env.local del servidor.');
    }
    if (!email || !password) {
        throw new Error('Debe proporcionar email y contraseña.');
    }

    return new OdooClient(odooUrl, odooDb, email, password);
}

// Parse a PDF/DOCX buffer into structured order data (null if unsupported type)
async function parseDocumentBuffer(fileName, fileBuffer) {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith('.docx')) {
        // Lazy load to avoid crashing serverless on startup
        const { parseDocx } = require('./docx-parser');
        // Write to a temporary file for Mammoth/AdmZip
        const safeName = path.basename(fileName).replace(/[^\w.\-]/g, '_');
        const tempFilePath = path.join(os.tmpdir(), `temp_${Date.now()}_${safeName}`);
        fs.writeFileSync(tempFilePath, fileBuffer);
        try {
            return parseDocx(tempFilePath);
        } finally {
            // Always clean up temp file
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    }

    if (lowerName.endsWith('.pdf')) {
        // Lazy load to avoid crashing serverless on startup
        const { parsePdf } = require('./pdf-parser');
        return await parsePdf(fileBuffer);
    }

    return null;
}

// Convert a document date (DD/MM/YYYY, DD-MM-YYYY or ISO) to Odoo's 'YYYY-MM-DD HH:MM:SS', null if invalid
function toOdooDatetime(value) {
    if (!value) return null;
    const dmy = String(value).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    const date = dmy
        ? new Date(Date.UTC(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10), 12))
        : new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

// Odoo domain to filter attachments the parsers can read
const SUPPORTED_ATTACHMENT_DOMAIN = [
    '|', '|',
    ['mimetype', 'in', [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]],
    ['name', '=ilike', '%.pdf'],
    ['name', '=ilike', '%.docx']
];

// Health check endpoint - useful for diagnosing Vercel deployments
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        hasOdooUrl: !!process.env.ODOO_URL,
        hasOdooDb: !!process.env.ODOO_DB,
        isVercel: !!process.env.VERCEL,
        nodeVersion: process.version
    });
});

// Endpoint: Login with Odoo credentials (email + password)
app.post('/api/odoo/connect', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const uid = await client.authenticate();

        res.json({
            success: true,
            uid,
            db: process.env.ODOO_DB,
            url: process.env.ODOO_URL,
            message: 'Conexión exitosa a Odoo'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Get partners/vendors from Odoo
app.post('/api/odoo/partners', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const search = req.body.search || '';
        
        // Search criteria
        const domain = [['supplier_rank', '>', 0]];
        if (search) {
            domain.push(['name', 'ilike', search]);
        }

        const partners = await client.executeKw('res.partner', 'search_read', [
            domain
        ], {
            fields: ['id', 'name', 'email', 'phone', 'vat'],
            limit: 100
        });

        res.json({
            success: true,
            partners
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Upload and Parse purchase order
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded.' });
        }

        const fileName = req.file.originalname;
        const fileBuffer = req.file.buffer;
        let parsedData;

        console.log(`Received file: ${fileName}, size: ${fileBuffer.length} bytes`);

        parsedData = await parseDocumentBuffer(fileName, fileBuffer);

        if (!parsedData) {
            return res.status(400).json({
                success: false,
                message: 'Unsupported file type. Only .docx and .pdf files are supported.'
            });
        }

        if (!parsedData.success) {
            return res.status(500).json({
                success: false,
                message: `Failed to parse file: ${parsedData.error}`
            });
        }

        res.json({
            success: true,
            fileName,
            data: parsedData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: List won CRM opportunities (by default only those with PDF/DOCX attachments)
app.post('/api/odoo/crm/leads', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const search = (req.body.search || '').trim();
        const onlyWithAttachments = req.body.onlyWithAttachments !== false;

        // Only opportunities in a "won" stage are ready to be quoted to suppliers
        const domain = [['stage_id.is_won', '=', true]];
        if (search) {
            domain.push('|', '|', ['name', 'ilike', search], ['partner_id.name', 'ilike', search], ['partner_name', 'ilike', search]);
        }

        if (onlyWithAttachments) {
            const leadAttachments = await client.executeKw('ir.attachment', 'search_read', [
                [['res_model', '=', 'crm.lead'], ...SUPPORTED_ATTACHMENT_DOMAIN]
            ], {
                fields: ['res_id'],
                order: 'id desc',
                limit: 2000
            });
            const leadIdsWithFiles = [...new Set(leadAttachments.map(a => a.res_id).filter(Boolean))];
            domain.push(['id', 'in', leadIdsWithFiles]);
        }

        const leads = await client.executeKw('crm.lead', 'search_read', [domain], {
            fields: ['id', 'name', 'partner_id', 'partner_name', 'stage_id', 'user_id', 'type', 'expected_revenue', 'create_date'],
            order: 'create_date desc',
            limit: 50
        });

        // Fetch the supported files of all listed leads in a single query
        const leadIds = leads.map(l => l.id);
        const attachments = leadIds.length === 0 ? [] : await client.executeKw('ir.attachment', 'search_read', [
            [['res_model', '=', 'crm.lead'], ['res_id', 'in', leadIds], ...SUPPORTED_ATTACHMENT_DOMAIN]
        ], {
            fields: ['id', 'name', 'res_id', 'mimetype', 'file_size', 'create_date'],
            order: 'create_date desc'
        });

        // Purchase orders already generated from each lead (linked through the source document)
        const leadNames = [...new Set(leads.map(l => l.name))];
        const purchaseOrders = leadNames.length === 0 ? [] : await client.executeKw('purchase.order', 'search_read', [
            [['origin', 'in', leadNames], ['state', '!=', 'cancel']]
        ], {
            fields: ['id', 'name', 'origin', 'state', 'partner_id'],
            order: 'id desc'
        });

        const result = leads.map(lead => ({
            id: lead.id,
            name: lead.name,
            type: lead.type,
            partner: lead.partner_id ? lead.partner_id[1] : (lead.partner_name || ''),
            stage: lead.stage_id ? lead.stage_id[1] : '',
            salesperson: lead.user_id ? lead.user_id[1] : '',
            expectedRevenue: lead.expected_revenue,
            createDate: lead.create_date,
            attachments: attachments
                .filter(a => a.res_id === lead.id)
                .map(a => ({ id: a.id, name: a.name, mimetype: a.mimetype, size: a.file_size })),
            purchaseOrders: purchaseOrders
                .filter(po => po.origin === lead.name)
                .map(po => ({ id: po.id, name: po.name, state: po.state, partner: po.partner_id ? po.partner_id[1] : '' }))
        }));

        res.json({
            success: true,
            leads: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Download a CRM attachment from Odoo and parse it
app.post('/api/odoo/crm/parse-attachment', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const attachmentId = parseInt(req.body.attachmentId, 10);

        if (!attachmentId) {
            return res.status(400).json({ success: false, message: 'Missing attachmentId.' });
        }

        const records = await client.executeKw('ir.attachment', 'read', [
            [attachmentId],
            ['name', 'datas', 'res_model', 'res_id']
        ]);
        const attachment = records && records[0];

        if (!attachment || !attachment.datas) {
            return res.status(404).json({ success: false, message: 'Adjunto no encontrado o vacío en Odoo.' });
        }
        if (attachment.res_model !== 'crm.lead') {
            return res.status(400).json({ success: false, message: 'El adjunto no pertenece a una oportunidad del CRM.' });
        }

        const fileBuffer = Buffer.from(attachment.datas, 'base64');
        console.log(`Parsing CRM attachment: ${attachment.name}, size: ${fileBuffer.length} bytes`);

        const parsedData = await parseDocumentBuffer(attachment.name, fileBuffer);

        if (!parsedData) {
            return res.status(400).json({
                success: false,
                message: 'Tipo de archivo no soportado. Solo se admiten .docx y .pdf.'
            });
        }
        if (!parsedData.success) {
            return res.status(500).json({
                success: false,
                message: `Failed to parse file: ${parsedData.error}`
            });
        }

        res.json({
            success: true,
            fileName: attachment.name,
            fileSize: fileBuffer.length,
            leadId: attachment.res_id,
            data: parsedData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Verify if products exist in Odoo
app.post('/api/odoo/verify-products', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const { items } = req.body;

        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, message: 'Missing items list.' });
        }

        const verifiedItems = [];

        for (const item of items) {
            // Try to find the product in Odoo by description/name
            const products = await client.searchProduct(item.description);
            
            if (products && products.length > 0) {
                // Product found
                verifiedItems.push({
                    ...item,
                    exists: true,
                    odooProduct: products[0], // link to the first match
                    matches: products
                });
            } else {
                // Product not found
                verifiedItems.push({
                    ...item,
                    exists: false,
                    odooProduct: null,
                    matches: []
                });
            }
        }

        res.json({
            success: true,
            items: verifiedItems
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Create missing products in Odoo
app.post('/api/odoo/create-products', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const { products } = req.body;

        if (!products || !Array.isArray(products)) {
            return res.status(400).json({ success: false, message: 'Missing products list.' });
        }

        const createdProducts = [];

        for (const prod of products) {
            // prod should have: name, default_code, standard_price, list_price, type
            const productId = await client.createProduct({
                name: prod.name,
                default_code: prod.default_code || '',
                standard_price: prod.standard_price || 0.0,
                list_price: prod.list_price || 0.0,
                type: prod.type || 'product' // default storable product
            });

            createdProducts.push({
                temporaryId: prod.temporaryId, // used in frontend to map back
                id: productId,
                name: prod.name,
                default_code: prod.default_code
            });
        }

        res.json({
            success: true,
            products: createdProducts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Create Purchase Order in Odoo
app.post('/api/odoo/create-purchase-order', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const { supplierName, items, orderDate, orderNumber, leadId, attachmentId } = req.body;

        if (!supplierName) {
            return res.status(400).json({ success: false, message: 'Supplier name is required.' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items list cannot be empty.' });
        }

        // 0. Only one purchase order per CRM opportunity (linked through the source document)
        let lead = null;
        if (leadId) {
            const leads = await client.executeKw('crm.lead', 'read', [[parseInt(leadId, 10)], ['name']]);
            lead = leads && leads[0] ? { id: leads[0].id, name: leads[0].name } : null;
        }
        if (lead) {
            const existing = await client.executeKw('purchase.order', 'search_read', [
                [['origin', '=', lead.name], ['state', '!=', 'cancel']]
            ], { fields: ['name'], limit: 1 });
            if (existing.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: `La oportunidad "${lead.name}" ya tiene la orden de compra ${existing[0].name}. Cancélela en Odoo si necesita generar una nueva.`
                });
            }
        }

        // 1. Find or create the PVC brand (vendor partner) in Odoo
        const partner = await client.findOrCreatePartner(supplierName);

        // 2. Prepare Odoo purchase lines
        // Each item in req.body.items must have: product_id, qty, price_unit, description
        const poItems = items.map(item => ({
            product_id: item.productId,
            name: item.description,
            qty: item.qty,
            price_unit: item.priceUnit || 0.0
        }));

        // 3. Create the purchase order in Odoo (from the CRM, the opportunity name is the source document)
        const result = await client.createPurchaseOrder(
            partner.id,
            poItems,
            toOdooDatetime(orderDate),
            orderNumber || null,
            lead ? lead.name : null
        );

        // 4. Link the purchase order back to the CRM opportunity (non-fatal)
        const warnings = [];
        if (lead) {
            if (attachmentId) {
                try {
                    await client.copyAttachment(parseInt(attachmentId, 10), 'purchase.order', result.id);
                } catch (error) {
                    warnings.push(`No se pudo copiar el adjunto a la orden: ${error.message}`);
                }
            }
            try {
                await client.postNote('crm.lead', lead.id, `Cotización de compra ${result.name} creada desde Odoo Compras (marca de PVC: ${partner.name}).`);
                await client.postNote('purchase.order', result.id, `Creada desde la oportunidad CRM: ${lead.name}`);
            } catch (error) {
                warnings.push(`No se pudo registrar la nota en el chatter: ${error.message}`);
            }
        }

        res.json({
            success: true,
            purchaseOrder: result,
            partner,
            lead,
            warnings,
            message: `Purchase Order ${result.name} successfully created in Odoo.`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Serve frontend assets in production (only when NOT running on Vercel)
if (!process.env.VERCEL) {
    const frontendBuildPath = path.join(__dirname, 'frontend', 'dist');
    if (fs.existsSync(frontendBuildPath)) {
        app.use(express.static(frontendBuildPath));
        app.get(/.*/, (req, res) => {
            res.sendFile(path.join(frontendBuildPath, 'index.html'));
        });
    }
}

// Only listen if not running as a Vercel Serverless Function
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Global error handler - catches any unhandled errors before they cause a 500
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

module.exports = app;
