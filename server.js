const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const OdooClient = require('./odoo-client');
const { buildTrackingBoard } = require('./tracking');

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

// Endpoint: Tracking board of won CRM opportunities (Técnico, Financiero, Producción, Despacho, Instalación)
app.post('/api/odoo/tracking', async (req, res) => {
    try {
        const client = getOdooClient(req);
        const board = await buildTrackingBoard(client, {
            search: (req.body.search || '').trim(),
            stageId: parseInt(req.body.stageId, 10) || null
        });

        res.json({
            success: true,
            ...board
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
