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
}

module.exports = OdooClient;
