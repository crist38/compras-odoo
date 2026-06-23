const { PDFParse } = require('pdf-parse');

async function parsePdf(fileBuffer) {
    let parser;
    try {
        parser = new PDFParse({ data: fileBuffer });
        const data = await parser.getText();
        const text = data.text;
        
        const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');
        
        let orderNumber = '';
        let supplier = 'Desconocido';
        let date = '';
        let reference = '';
        let shippingAddress = '';
        
        // Match order number
        for (const line of lines) {
            const matchOrder = line.match(/orden\s+de\s+compra\s+n\s*[°\.]?\s*(\d+)/i);
            if (matchOrder) {
                orderNumber = matchOrder[1];
                break;
            }
        }
        
        // Find supplier, date, reference, address
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.toLowerCase().includes('señores')) {
                supplier = line.replace(/señores\s*/i, '').trim();
                // If it contains address or other details, clean it
                if (supplier.includes('Dirección')) {
                    supplier = supplier.split('Dirección')[0].trim();
                }
            }
            
            if (line.toLowerCase().startsWith('obra')) {
                reference = line.replace(/obra\s*[:\s]*/i, '').trim();
            }
            
            if (line.toLowerCase() === 'fecha' && i + 2 < lines.length) {
                // In some PDFs, 'fecha' is followed by 'recepción' and then the date value
                // Or 'fecha' is directly above the date.
                // Let's search for a date format in the next few lines
                for (let j = 1; j <= 4; j++) {
                    if (lines[i+j] && lines[i+j].match(/\d{2}-\d{2}-\d{4}/)) {
                        date = lines[i+j];
                        break;
                    }
                }
            }
            
            if ((line.toLowerCase() === 'recepción' || line.toLowerCase().includes('recepcion')) && i + 2 < lines.length) {
                for (let j = 1; j <= 4; j++) {
                    if (lines[i+j] && (lines[i+j].toLowerCase().includes('bodega') || lines[i+j].toLowerCase().includes('coquimbo'))) {
                        shippingAddress = lines[i+j];
                        break;
                    }
                }
            }
        }

        // Clean supplier name
        const cleanSupplierName = (name) => {
            let n = name;
            n = n.split(/direcc|atenc|tel/i)[0];
            n = n.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\s.\-_]+$/g, '');
            return n.trim();
        };
        supplier = cleanSupplierName(supplier);

        // Find items table start
        let headerIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().match(/^(cant|cnt)\.?\s+u\/m\s+detalle/i)) {
                headerIndex = i;
                break;
            }
        }

        const items = [];
        if (headerIndex !== -1) {
            const tableLines = [];
            for (let i = headerIndex + 1; i < lines.length; i++) {
                const line = lines[i];
                const lowerLine = line.toLowerCase();
                
                // Stop at footer keywords
                if (lowerLine.includes('miguel contreras') || 
                    lowerLine.includes('neto') || 
                    lowerLine.includes('iva 19%') || 
                    lowerLine.includes('total') || 
                    lowerLine.includes('sodival') ||
                    lowerLine.includes('facturar')) {
                    break;
                }
                tableLines.push(line);
            }

            // Heuristic to split tableLines into qtys, units, and descriptions
            const qtys = [];
            const units = [];
            const descriptions = [];

            // A unit of measure is typically 'unidades', 'cajas', 'paquete', 'unidad', 'unidades', etc.
            const uomKeywords = ['unidades', 'unid', 'unidad', 'cajas', 'caja', 'paquete', 'paquetes', 'unidadesunidades', 'unidadesunidadesunidades'];

            for (const line of tableLines) {
                const isQty = !isNaN(parseFloat(line.replace(',', '.'))) && line.match(/^\d+$/);
                const isUom = uomKeywords.some(u => line.toLowerCase().includes(u));

                if (isQty) {
                    qtys.push(parseFloat(line.replace(',', '.')));
                } else if (isUom) {
                    units.push(line);
                } else {
                    descriptions.push(line);
                }
            }

            const count = Math.max(qtys.length, descriptions.length);
            for (let i = 0; i < count; i++) {
                items.push({
                    qty: qtys[i] || 1.0,
                    unit: units[i] || 'UNIDADES',
                    description: (descriptions[i] || 'Producto sin descripción').replace(/\s+/g, ' ').trim()
                });
            }
        }

        return {
            success: true,
            orderNumber,
            supplier,
            date,
            reference,
            shippingAddress,
            items
        };
    } catch (error) {
        console.error('Error parsing PDF:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (parser) {
            await parser.destroy();
        }
    }
}

module.exports = { parsePdf };
