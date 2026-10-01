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

    // Helper to find or create a customer by exact name (case-insensitive), so each customer has one record
    async findOrCreateCustomer(name) {
        console.log(`Searching for customer: "${name}"`);
        const partners = await this.executeKw("res.partner", "search_read", [
            [["name", "=ilike", name]]
        ], {
            fields: ["id", "name"],
            order: "customer_rank desc, id asc",
            limit: 1
        });

        if (partners && partners.length > 0) {
            console.log(`Customer found: ${partners[0].name} (ID: ${partners[0].id})`);
            return partners[0];
        }

        console.log(`Customer "${name}" not found. Creating it...`);
        const newPartnerId = await this.executeKw("res.partner", "create", [{
            name: name,
            customer_rank: 1 // Mark as customer
        }]);

        console.log(`Customer "${name}" created with ID: ${newPartnerId}`);
        return { id: newPartnerId, name: name };
    }

    // Helper to find or create a CRM/sales tag by exact name (one tag per PVC brand)
    async findOrCreateTag(name) {
        const tags = await this.executeKw("crm.tag", "search_read", [
            [["name", "=ilike", name]]
        ], {
            fields: ["id", "name"],
            limit: 1
        });

        if (tags && tags.length > 0) {
            return tags[0];
        }

        const tagId = await this.executeKw("crm.tag", "create", [{ name }]);
        console.log(`Tag "${name}" created with ID: ${tagId}`);
        return { id: tagId, name };
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

    // Helper to create a sales quotation (sale.order in draft state)
    async createSaleOrder({ partnerId, items, orderDate, clientOrderRef, origin, opportunityId, tagIds }) {
        console.log(`Creating Sales Quotation in Odoo for customer ID: ${partnerId}...`);

        // item should have: product_id, qty, price_unit, name (description)
        const orderLines = items.map(item => [0, 0, {
            product_id: item.product_id,
            name: item.name || "Producto sin descripción",
            product_uom_qty: parseFloat(item.qty) || 1.0,
            price_unit: parseFloat(item.price_unit) || 0.0
        }]);

        const soData = {
            partner_id: partnerId,
            order_line: orderLines
        };

        if (orderDate) {
            soData.date_order = orderDate; // 'YYYY-MM-DD HH:MM:SS' in UTC
        }
        if (clientOrderRef) {
            soData.client_order_ref = clientOrderRef; // Customer Reference (quote number in the document)
        }
        if (origin) {
            soData.origin = origin; // Source Document (e.g. CRM opportunity name)
        }
        if (tagIds && tagIds.length > 0) {
            soData.tag_ids = [[6, 0, tagIds]];
        }

        let soId;
        if (opportunityId) {
            // opportunity_id comes from the sale_crm module (installed with Sales + CRM);
            // it shows the quotation in the opportunity's "Quotations" smart button
            try {
                soId = await this.executeKw("sale.order", "create", [{ ...soData, opportunity_id: opportunityId }]);
            } catch (error) {
                console.warn("Could not set opportunity_id (sale_crm missing?), creating without it:", error.message);
            }
        }
        if (!soId) {
            soId = await this.executeKw("sale.order", "create", [soData]);
        }
        console.log(`Sales Quotation created with ID: ${soId}`);

        // Read the created quotation to get its name (e.g. "S00001")
        const soDetails = await this.executeKw("sale.order", "read", [
            [soId],
            ["name"]
        ]);

        return {
            id: soId,
            name: soDetails && soDetails.length > 0 ? soDetails[0].name : `SO #${soId}`
        };
    }

    // Helper to duplicate an attachment onto another record
    async copyAttachment(attachmentId, resModel, resId) {
        const result = await this.executeKw("ir.attachment", "copy", [[attachmentId]], {
            default: { res_model: resModel, res_id: resId }
        });
        // Odoo < 17 returns an int, Odoo 17+ may return a list of ids
        return Array.isArray(result) ? result[0] : result;
    }

    // Helper to log an internal note in a record's chatter
    async postNote(model, resId, body) {
        return await this.executeKw(model, "message_post", [[resId]], {
            body,
            message_type: "comment",
            subtype_xmlid: "mail.mt_note"
        });
    }
}

module.exports = OdooClient;
