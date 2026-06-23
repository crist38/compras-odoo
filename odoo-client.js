// Node.js v24 includes native global fetch, so no external package is required.

class OdooClient {
    constructor(url, db, username, password) {
        // Clean URL to make sure it doesn't end with a slash
        this.url = url.endsWith('/') ? url.slice(0, -1) : url;
        this.db = db;
        this.username = username;
        this.password = password;
        this.uid = null;
    }

    async jsonRpcRequest(service, method, args) {
        const endpoint = `${this.url}/jsonrpc`;
        const payload = {
            jsonrpc: "2.0",
            method: "call",
            params: {
                service,
                method,
                args
            },
            id: Math.floor(Math.random() * 1000000)
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                console.error("Odoo JSON-RPC Error Response:", data.error);
                throw new Error(data.error.data?.message || data.error.message || JSON.stringify(data.error));
            }

            return data.result;
        } catch (error) {
            console.error(`Odoo Client error on ${service}/${method}:`, error);
            throw error;
        }
    }

    async authenticate() {
        console.log(`Authenticating with Odoo at ${this.url} for user ${this.username}...`);
        const uid = await this.jsonRpcRequest("common", "login", [
            this.db,
            this.username,
            this.password
        ]);

        if (!uid) {
            throw new Error("Authentication failed: invalid username, password, or database name.");
        }

        this.uid = uid;
        console.log(`Authentication successful. UID: ${uid}`);
        return uid;
    }

    async executeKw(model, method, args = [], kwargs = {}) {
        if (!this.uid) {
            await this.authenticate();
        }

        return await this.jsonRpcRequest("object", "execute_kw", [
            this.db,
            this.uid,
            this.password,
            model,
            method,
            args,
            kwargs
        ]);
    }

    // Helper to find or create a vendor
    async findOrCreatePartner(name) {
        console.log(`Searching for partner: "${name}"`);
        const partners = await this.executeKw("res.partner", "search_read", [
            [["name", "ilike", name], ["supplier_rank", ">", 0]]
        ], {
            fields: ["id", "name"],
            limit: 1
        });

        if (partners && partners.length > 0) {
            console.log(`Partner found: ${partners[0].name} (ID: ${partners[0].id})`);
            return partners[0];
        }

        // If not found, search without the supplier_rank constraint in case it's a new system or rank is not set
        const partnersAny = await this.executeKw("res.partner", "search_read", [
            [["name", "ilike", name]]
        ], {
            fields: ["id", "name"],
            limit: 1
        });

        if (partnersAny && partnersAny.length > 0) {
            console.log(`Partner found (any rank): ${partnersAny[0].name} (ID: ${partnersAny[0].id})`);
            return partnersAny[0];
        }

        // Create partner if not exists
        console.log(`Partner "${name}" not found. Creating it...`);
        const newPartnerId = await this.executeKw("res.partner", "create", [{
            name: name,
            supplier_rank: 1, // Mark as vendor
            is_company: true
        }]);

        console.log(`Partner "${name}" created with ID: ${newPartnerId}`);
        return { id: newPartnerId, name: name };
    }

    // Helper to search a product by name or default_code
    async searchProduct(searchTerm) {
        console.log(`Searching product in Odoo with term: "${searchTerm}"`);
        // Search by default_code (sku) or name
        const products = await this.executeKw("product.product", "search_read", [
            ["|", ["default_code", "=", searchTerm], ["name", "ilike", searchTerm]]
        ], {
            fields: ["id", "name", "default_code", "list_price", "standard_price", "uom_id"],
            limit: 5
        });

        return products;
    }

    // Helper to create a product
    async createProduct(productData) {
        console.log(`Creating product in Odoo:`, productData);

        const baseFields = {
            name: productData.name,
            default_code: productData.default_code || "",
            standard_price: parseFloat(productData.standard_price) || 0.0,
            list_price: parseFloat(productData.list_price) || 0.0,
            purchase_ok: true,
            sale_ok: true
        };

        // Strategy A (Odoo 17/18): type='consu' + is_storable=true
        // In Odoo 17+, 'product' was removed as a type value. Storable products
        // are now type='consu' with the boolean is_storable=true.
        try {
            const productId = await this.executeKw("product.product", "create", [{
                ...baseFields,
                type: "consu",
                is_storable: true
            }]);
            console.log(`Product "${productData.name}" created (Strategy A: consu + is_storable) ID: ${productId}`);
            return productId;
        } catch (errorA) {
            console.warn("Strategy A failed:", errorA.message);

            // Strategy B (Odoo 15/16): detailed_type='product'
            try {
                const productId = await this.executeKw("product.product", "create", [{
                    ...baseFields,
                    detailed_type: "product"
                }]);
                console.log(`Product "${productData.name}" created (Strategy B: detailed_type='product') ID: ${productId}`);
                return productId;
            } catch (errorB) {
                console.warn("Strategy B failed:", errorB.message);

                // Strategy C (Universal fallback): type='consu' only (consumable, no stock tracking)
                try {
                    const productId = await this.executeKw("product.product", "create", [{
                        ...baseFields,
                        type: "consu"
                    }]);
                    console.log(`Product "${productData.name}" created (Strategy C: consu fallback) ID: ${productId}`);
                    return productId;
                } catch (errorC) {
                    console.error("All product creation strategies failed.");
                    throw errorC;
                }
            }
        }
    }

    // Helper to create a purchase order
    async createPurchaseOrder(partnerId, items, orderDate, clientOrderRef) {
        console.log(`Creating Purchase Order in Odoo for partner ID: ${partnerId}...`);

        // Prepare order lines
        const orderLines = [];
        for (const item of items) {
            // item should have: product_id, qty, price_unit, name (description)
            const line = [0, 0, {
                product_id: item.product_id,
                name: item.name || "Producto sin descripción",
                product_qty: parseFloat(item.qty) || 1.0,
                price_unit: parseFloat(item.price_unit) || 0.0,
                date_planned: new Date().toISOString().split('T')[0] // today's date
            }];
            orderLines.push(line);
        }

        const poData = {
            partner_id: partnerId,
            order_line: orderLines
        };

        if (orderDate) {
            poData.date_order = orderDate; // should be 'YYYY-MM-DD HH:MM:SS' format in UTC
        }

        if (clientOrderRef) {
            poData.partner_ref = clientOrderRef; // Supplier Reference / Order Number
        }

        const poId = await this.executeKw("purchase.order", "create", [poData]);
        console.log(`Purchase Order created with ID: ${poId}`);
        
        // Read the created PO to get its name (e.g. "P00001")
        const poDetails = await this.executeKw("purchase.order", "read", [
            [poId],
            ["name"]
        ]);

        return {
            id: poId,
            name: poDetails && poDetails.length > 0 ? poDetails[0].name : `PO #${poId}`
        };
    }
}

module.exports = OdooClient;
