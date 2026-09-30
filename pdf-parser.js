// Must be loaded before pdf-parse: it statically requires @napi-rs/canvas and defines
// DOMMatrix/Path2D/ImageData globals that pdfjs needs. On serverless (Vercel) the
// dynamic canvas import inside pdfjs is not bundled, causing "DOMMatrix is not defined".
const { CanvasFactory, getData } = require('pdf-parse/worker');
const { PDFParse } = require('pdf-parse');

PDFParse.setWorker(getData());

// Parses the "Presupuesto" format (Número/Versión, one block per window with
// "Pos: Vn Medidas", description and an "Importe /Uds Unidades TOTAL" table)
function parseQuoteFormat(lines, text) {
    const orderNumber = (text.match(/N[úu]mero:\s*(\d+)/i) || [])[1] || '';
    const date = (text.match(/Fecha:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i) || [])[1] || '';
    const reference = ((text.match(/Referencia:\s*([^\n]+)/i) || [])[1] || '').trim();
    const customer = ((text.match(/Estimad[oa]s?\s+([^\n:]+):/i) || [])[1] || '').trim();

    const toNumber = (str) => parseFloat(str.replace(/[^\d,]/g, '').replace(',', '.')) || 0;

    // Lines that are labels, page headers or footers, never part of a description
    const isNoise = (line) =>
        /^(Descripci[óo]n:|Color:|Referencia:|N[úu]mero:|Pag\s*\d+|P[áa]gina:)/i.test(line) ||
        /Importe\s*\/\s*Uds/i.test(line) ||
        /^--.*--$/.test(line) ||
        /^(PASAJE|-\s*LA SERE|TEL:)/i.test(line) ||
        line.includes('@');

    // Price row: quantity + unit price + total in any order, e.g. "$521169 1 $521.169" or "1 $521.169\t$521169"
    const parsePriceLine = (line) => {
        if (!/^[\d\s$.,]+$/.test(line)) return null;
        const tokens = line.split(/\s+/).filter(Boolean);
        const prices = tokens.filter(t => t.startsWith('$')).map(toNumber);
        const qtyTokens = tokens.filter(t => !t.startsWith('$'));
        if (prices.length !== 2 || qtyTokens.length !== 1) return null;
        return {
            qty: parseFloat(qtyTokens[0].replace(',', '.')) || 1,
            unitPrice: Math.min(...prices),
            total: Math.max(...prices)
        };
    };
    const posLineRegex = /^Pos:\s*(\S+)\s+Medidas:\s*(.+)$/i;

    const items = [];
    const positions = [];
    let buffer = [];

    for (const line of lines) {
        const posMatch = line.match(posLineRegex);
        if (posMatch) {
            positions.push({ pos: posMatch[1], measures: posMatch[2].trim() });
            continue;
        }

        const price = parsePriceLine(line);
        if (price) {
            items.push({
                qty: price.qty,
                unit: 'UNIDADES',
                description: buffer.join(' ').replace(/\s+/g, ' ').trim() || 'Producto sin descripción',
                unitPrice: price.unitPrice,
                total: price.total
            });
            buffer = [];
            continue;
        }

        // A new page resets the description being accumulated
        if (/^Pag\s*\d+$/i.test(line)) {
            buffer = [];
            continue;
        }

        if (!isNoise(line)) {
            buffer.push(line);
        }
    }

    // Pos markers appear in the same order as the items
    items.forEach((item, i) => {
        if (positions[i]) {
            item.position = positions[i].pos;
            item.measures = positions[i].measures;
        }
    });

    return {
        success: true,
        documentType: 'presupuesto',
        orderNumber,
        supplier: '', // quotes are addressed to the customer; the supplier must be chosen by the user
        customer,
        date,
        reference,
        shippingAddress: '',
        items
    };
}

// Parses the "PRESUPUESTO 2026/30/1" format (blocks starting with "Pos. N - V1",
// details per line and a closing "M2 Unit. ... UDS: qty  unit price  total" line)
function parseQuoteFormatPositions(lines, text) {
    const orderNumber = (text.match(/PRESUPUESTO\s+([\w\/\-]+)/i) || [])[1] || '';
    const date = (lines.find(l => /^\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{4}$/.test(l)) || '');
    const reference = ((text.match(/Obra:\s*([^\n]+)/i) || [])[1] || '').trim();
    const customerLine = lines.find(l => /^\d+\s*-\s*\S/.test(l) && !/^Pos\./i.test(l)) || '';
    const customer = customerLine.replace(/^\d+\s*-\s*/, '').trim();

    const toNumber = (str) => parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;

    const posRegex = /^Pos\.\s*(\d+)\s*-\s*(.+?)\s+Importe/i;
    const qtyRegex = /UDS:\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/i;

    const items = [];
    let current = null;

    for (const line of lines) {
        const posMatch = line.match(posRegex);
        if (posMatch) {
            current = { position: posMatch[2].trim(), details: [] };
            continue;
        }
        if (!current) continue;

        const qtyMatch = line.match(qtyRegex);
        if (qtyMatch) {
            const [title, ...rest] = current.details;
            items.push({
                qty: toNumber(qtyMatch[1]) || 1,
                unit: 'UNIDADES',
                description: [title, ...rest].filter(Boolean).join(' - ') || 'Producto sin descripción',
                unitPrice: toNumber(qtyMatch[2]),
                total: toNumber(qtyMatch[3]),
                position: current.position,
                measures: current.measures || ''
            });
            current = null;
            continue;
        }

        const sizeMatch = line.match(/^Ancho:\s*([\d.]+)\s*-\s*Alto:\s*([\d.]+)/i);
        if (sizeMatch) {
            current.measures = `${sizeMatch[1].replace(/\./g, '')} x ${sizeMatch[2].replace(/\./g, '')} mm`;
            current.details.push(current.measures);
            continue;
        }

        const colorMatch = line.match(/^Color:\s*(.*)$/i);
        if (colorMatch) {
            if (colorMatch[1].trim()) current.details.push(colorMatch[1].trim());
            continue;
        }

        current.details.push(line.replace(/\s+/g, ' ').trim());
    }

    return {
        success: true,
        documentType: 'presupuesto',
        orderNumber,
        supplier: '', // quotes are addressed to the customer; the supplier must be chosen by the user
        customer,
        date,
        reference,
        shippingAddress: '',
        items
    };
}

// Parses the "PRESUPUESTO Nº: A/42 - 1" format (title + "⦁ Key: value" bullets,
// closed by a "V1 1 748.538 CLP$ 748.538 CLP$" line: type, units, net price, total)
function parseQuoteFormatBullets(lines, text) {
    const orderNumber = ((text.match(/PRESUPUESTO\s*N[º°o]?\s*:\s*([^\n]+)/i) || [])[1] || '').replace(/\s+/g, '').trim();
    const date = (text.match(/FECHA:\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) || [])[1] || '';
    const obraIndex = lines.findIndex(l => /^OBRA:/i.test(l));
    const obraInline = obraIndex >= 0 ? lines[obraIndex].replace(/^OBRA:\s*/i, '').trim() : '';
    const customer = (obraInline || (obraIndex >= 0 ? lines[obraIndex + 1] || '' : '')).replace(/^\d+\s+/, '').trim();

    const toNumber = (str) => parseFloat(String(str).replace(/\./g, '').replace(',', '.')) || 0;

    const priceRegex = /^(\S+)\s+([\d.,]+)\s+([\d.,]+)\s*CLP\$\s+([\d.,]+)\s*CLP\$$/i;
    // Bullet attributes worth keeping in the product description
    const keptAttributes = ['serie', 'color', 'medida', 'superficie'];

    const items = [];
    let title = [];
    let attributes = [];
    let inBlock = false;

    for (const line of lines) {
        if (/^DESCRIPCI[ÓO]N\b/i.test(line)) {
            inBlock = true;
            title = [];
            attributes = [];
            continue;
        }
        if (!inBlock) continue;

        const priceMatch = line.match(priceRegex);
        if (priceMatch) {
            const measure = attributes.find(a => a.key === 'medida');
            items.push({
                qty: toNumber(priceMatch[2]) || 1,
                unit: 'UNIDADES',
                description: [title.join(' '), ...attributes.map(a => a.value)].filter(Boolean).join(' - ').replace(/\s+/g, ' ').trim() || 'Producto sin descripción',
                unitPrice: toNumber(priceMatch[3]),
                total: toNumber(priceMatch[4]),
                position: priceMatch[1],
                measures: measure ? measure.value : ''
            });
            inBlock = false;
            continue;
        }

        const bulletMatch = line.match(/^[⦁•·\-]\s*([^:]+):\s*(.*)$/);
        if (bulletMatch) {
            const key = bulletMatch[1].trim().toLowerCase();
            if (keptAttributes.includes(key)) {
                // "Cristal 5 mm incoloro 0,773 × 1,986 m (3 u.)" -> "Cristal 5 mm incoloro"
                const value = key === 'superficie'
                    ? bulletMatch[2].replace(/\s+[\d,.]+\s*[×x].*$/, '').trim()
                    : bulletMatch[2].trim();
                attributes.push({ key, value });
            }
            continue;
        }

        if (attributes.length === 0) {
            title.push(line);
        }
    }

    return {
        success: true,
        documentType: 'presupuesto',
        orderNumber,
        supplier: '', // quotes are addressed to the customer; the supplier must be chosen by the user
        customer,
        date,
        reference: '',
        shippingAddress: '',
        items
    };
}

async function parsePdf(fileBuffer) {
    let parser;
    try {
        parser = new PDFParse({ data: fileBuffer, CanvasFactory });
        const data = await parser.getText();
        const text = data.text;

        const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');

        if (/Importe\s*\/\s*Uds/i.test(text) && /Pos:\s*\S+\s+Medidas:/i.test(text)) {
            return parseQuoteFormat(lines, text);
        }
        if (/^Pos\.\s*\d+\s*-/im.test(text) && /UDS:\s*[\d.,]+/i.test(text)) {
            return parseQuoteFormatPositions(lines, text);
        }
        if (/CLP\$/.test(text) && /TIPO\s+UDS\s+VALOR/i.test(text)) {
            return parseQuoteFormatBullets(lines, text);
        }

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
