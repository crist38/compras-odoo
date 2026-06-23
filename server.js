const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const OdooClient = require('./odoo-client');
const { parseDocx } = require('./docx-parser');
const { parsePdf } = require('./pdf-parser');

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

        if (fileName.endsWith('.docx')) {
            // Write to a temporary file for Mammoth/AdmZip
            const tempFilePath = path.join(__dirname, `temp_${Date.now()}_${fileName}`);
            fs.writeFileSync(tempFilePath, fileBuffer);
            try {
                parsedData = parseDocx(tempFilePath);
            } finally {
                // Always clean up temp file
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            }
        } else if (fileName.endsWith('.pdf')) {
            parsedData = await parsePdf(fileBuffer);
        } else {
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
        const { supplierName, items, orderDate, orderNumber } = req.body;

        if (!supplierName) {
            return res.status(400).json({ success: false, message: 'Supplier name is required.' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items list cannot be empty.' });
        }

        // 1. Find or create the vendor (partner) in Odoo
        const partner = await client.findOrCreatePartner(supplierName);

        // 2. Prepare Odoo purchase lines
        // Each item in req.body.items must have: product_id, qty, price_unit, description
        const poItems = items.map(item => ({
            product_id: item.productId,
            name: item.description,
            qty: item.qty,
            price_unit: item.priceUnit || 0.0
        }));

        // 3. Create the purchase order in Odoo
        const result = await client.createPurchaseOrder(
            partner.id, 
            poItems, 
            orderDate ? new Date(orderDate).toISOString().replace('T', ' ').substring(0, 19) : null,
            orderNumber || null
        );

        res.json({
            success: true,
            purchaseOrder: result,
            partner,
            message: `Purchase Order ${result.name} successfully created in Odoo.`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Serve frontend assets in production
const frontendBuildPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendBuildPath)) {
    app.use(express.static(frontendBuildPath));
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(frontendBuildPath, 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
