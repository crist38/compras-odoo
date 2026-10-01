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

// Endpoint: Get PVC brands (CRM/sales tags) from Odoo
app.post('/api/odoo/brands', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const search = (req.body.search || '').trim();

        const brands = await client.executeKw('crm.tag', 'search_read', [
            search ? [['name', 'ilike', search]] : []
        ], {
            fields: ['id', 'name'],
            order: 'name asc',
            limit: 100
        });

        res.json({
            success: true,
            brands
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint: Upload and Parse a document (purchase order / quote)
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

// Non-cancelled sales quotations linked to the given leads, each tagged with its leadId.
// Linked through opportunity_id (sale_crm) or, as a fallback, the source document (origin).
async function findLeadQuotations(client, leads) {
    if (leads.length === 0) return [];
    const leadIds = leads.map(l => l.id);
    const leadNames = [...new Set(leads.map(l => l.name))];
    const fields = ['id', 'name', 'origin', 'state', 'partner_id'];

    let orders;
    try {
        orders = await client.executeKw('sale.order', 'search_read', [
            [['state', '!=', 'cancel'], '|', ['opportunity_id', 'in', leadIds], ['origin', 'in', leadNames]]
        ], { fields: [...fields, 'opportunity_id'], order: 'id desc' });
    } catch (error) {
        // sale_crm not installed: opportunity_id doesn't exist
        orders = await client.executeKw('sale.order', 'search_read', [
            [['state', '!=', 'cancel'], ['origin', 'in', leadNames]]
        ], { fields, order: 'id desc' });
    }

    const result = [];
    for (const so of orders) {
        const linked = so.opportunity_id
            ? leads.filter(l => l.id === so.opportunity_id[0])
            : leads.filter(l => l.name === so.origin);
        for (const lead of linked) {
            result.push({
                leadId: lead.id,
                id: so.id,
                name: so.name,
                state: so.state,
                partner: so.partner_id ? so.partner_id[1] : ''
            });
        }
    }
    return result;
}

// Endpoint: List won CRM opportunities (by default only those with PDF/DOCX attachments)
app.post('/api/odoo/crm/leads', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const search = (req.body.search || '').trim();
        const onlyWithAttachments = req.body.onlyWithAttachments !== false;

        // Only opportunities in a "won" stage are ready to be quoted
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

        // Sales quotations already generated from each lead
        const quotations = await findLeadQuotations(client, leads);

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
            quotations: quotations
                .filter(so => so.leadId === lead.id)
                .map(({ id, name, state, partner }) => ({ id, name, state, partner }))
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

        // prod should have: name, default_code, standard_price, list_price, type
        const createOne = async (prod) => ({
            temporaryId: prod.temporaryId, // used in frontend to map back
            id: await client.createProduct({
                name: prod.name,
                default_code: prod.default_code || '',
                standard_price: prod.standard_price || 0.0,
                list_price: prod.list_price || 0.0,
                type: prod.type || 'product' // default storable product
            }),
            name: prod.name,
            default_code: prod.default_code
        });

        // The first product is created alone so the client learns which creation strategy
        // this Odoo version accepts; the rest run in parallel to stay within the serverless time limit.
        const createdProducts = [];
        if (products.length > 0) {
            createdProducts.push(await createOne(products[0]));
            createdProducts.push(...await Promise.all(products.slice(1).map(createOne)));
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

// Endpoint: Create a Sales Quotation (sale.order) in Odoo
app.post('/api/odoo/create-sale-order', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const { customerName, brandName, items, orderDate, orderNumber, leadId, attachmentId } = req.body;

        if (!brandName) {
            return res.status(400).json({ success: false, message: 'Debe indicar la marca de PVC.' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'La lista de artículos no puede estar vacía.' });
        }

        // 0. Only one quotation per CRM opportunity
        let lead = null;
        if (leadId) {
            const leads = await client.executeKw('crm.lead', 'read', [
                [parseInt(leadId, 10)],
                ['name', 'partner_id', 'partner_name', 'contact_name']
            ]);
            lead = leads && leads[0] ? leads[0] : null;
        }
        if (lead) {
            const existing = await findLeadQuotations(client, [lead]);
            if (existing.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: `La oportunidad "${lead.name}" ya tiene la cotización ${existing[0].name}. Cancélela en Odoo si necesita generar una nueva.`
                });
            }
        }

        const warnings = [];

        // 1. Customer: the opportunity's customer if it has one; otherwise found/created by exact name
        let customer;
        if (lead && lead.partner_id) {
            customer = { id: lead.partner_id[0], name: lead.partner_id[1] };
        } else {
            const name = (customerName || (lead && (lead.partner_name || lead.contact_name || lead.name)) || '').trim();
            if (!name) {
                return res.status(400).json({ success: false, message: 'Debe indicar el cliente.' });
            }
            customer = await client.findOrCreateCustomer(name);
            if (lead) {
                // Link the opportunity to its customer so it stays a single record
                try {
                    await client.executeKw('crm.lead', 'write', [[lead.id], { partner_id: customer.id }]);
                } catch (error) {
                    warnings.push(`No se pudo asignar el cliente a la oportunidad: ${error.message}`);
                }
            }
        }

        // 2. PVC brand as a tag (one tag per brand, shared by Sales and CRM)
        const brandTag = await client.findOrCreateTag(brandName.trim().toUpperCase());

        // 3. Create the quotation
        // Each item in req.body.items must have: productId, qty, priceUnit, description
        const soItems = items.map(item => ({
            product_id: item.productId,
            name: item.description,
            qty: item.qty,
            price_unit: item.priceUnit || 0.0
        }));

        const result = await client.createSaleOrder({
            partnerId: customer.id,
            items: soItems,
            orderDate: toOdooDatetime(orderDate),
            clientOrderRef: orderNumber || null,
            origin: lead ? lead.name : null,
            opportunityId: lead ? lead.id : null,
            tagIds: [brandTag.id]
        });

        // 4. Link the quotation back to the CRM opportunity (non-fatal)
        if (lead) {
            const attempt = async (action, warning) => {
                try {
                    await action();
                } catch (error) {
                    warnings.push(`${warning}: ${error.message}`);
                }
            };
            // Two independent chains run in parallel (to stay within the serverless time limit);
            // within each chain, writes to the same record stay sequential to avoid concurrent updates.
            await Promise.all([
                (async () => {
                    await attempt(() => client.executeKw('crm.lead', 'write', [[lead.id], { tag_ids: [[4, brandTag.id]] }]),
                        'No se pudo etiquetar la oportunidad con la marca');
                    await attempt(() => client.postNote('crm.lead', lead.id, `Cotización ${result.name} creada desde Odoo Compras (marca de PVC: ${brandTag.name}).`),
                        'No se pudo registrar la nota en la oportunidad');
                })(),
                (async () => {
                    if (attachmentId) {
                        await attempt(() => client.copyAttachment(parseInt(attachmentId, 10), 'sale.order', result.id),
                            'No se pudo copiar el adjunto a la cotización');
                    }
                    await attempt(() => client.postNote('sale.order', result.id, `Creada desde la oportunidad CRM: ${lead.name}`),
                        'No se pudo registrar la nota en la cotización');
                })()
            ]);
        }

        res.json({
            success: true,
            saleOrder: result,
            customer,
            brand: brandTag,
            lead: lead ? { id: lead.id, name: lead.name } : null,
            warnings,
            message: `Cotización ${result.name} creada en Odoo.`
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
