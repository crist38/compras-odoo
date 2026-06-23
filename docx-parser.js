const AdmZip = require('adm-zip');

/**
 * Extracts structured table data from a DOCX file.
 * Handles the nested XML elements (<w:tbl>, <w:tr>, <w:tc>, <w:p>, <w:t>)
 * using robust regex/string processing to avoid heavy XML parser dependencies.
 */
function parseDocx(filePath) {
    try {
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        const documentEntry = zipEntries.find(entry => entry.entryName === 'word/document.xml');
        
        if (!documentEntry) {
            throw new Error('Invalid docx format: word/document.xml not found.');
        }

        const xmlContent = documentEntry.getData().toString('utf8');
        
        // Helper to extract matches for a specific tag
        function getTags(text, tagName) {
            // Regex to find start and end tag, taking namespaces into account
            // e.g. <w:tr> ... </w:tr>
            const regex = new RegExp(`<w:${tagName}\\b[^>]*>([\\s\\S]*?)<\\/w:${tagName}>`, 'g');
            const matches = [];
            let match;
            while ((match = regex.exec(text)) !== null) {
                matches.push(match[1]);
            }
            return matches;
        }

        // Helper to extract text from <w:t> tags within an XML snippet
        function getCellText(cellXml) {
            const paragraphs = getTags(cellXml, 'p');
            const pTexts = paragraphs.map(pXml => {
                const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
                let tMatch;
                let text = '';
                while ((tMatch = tRegex.exec(pXml)) !== null) {
                    text += tMatch[1];
                }
                // Decode XML entities if any
                return decodeXmlEntities(text.trim());
            });
            // Filter out empty paragraphs
            return pTexts;
        }

        function decodeXmlEntities(str) {
            return str
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
        }

        const tables = getTags(xmlContent, 'tbl');
        const parsedTables = [];

        for (const tableXml of tables) {
            const rows = getTags(tableXml, 'tr');
            const parsedRows = [];

            for (const rowXml of rows) {
                const cells = getTags(rowXml, 'tc');
                const parsedCells = [];

                for (const cellXml of cells) {
                    const paragraphsText = getCellText(cellXml);
                    parsedCells.push(paragraphsText);
                }
                parsedRows.push(parsedCells);
            }
            parsedTables.push(parsedRows);
        }

        if (parsedTables.length === 0) {
            throw new Error('No tables found in the document.');
        }

        // Now, let's extract the order metadata and items from the first table
        const firstTable = parsedTables[0];
        
        // Parse metadata (typically Row 1 and Row 2)
        // Row 1 Cell 1 has supplier info
        // Row 1 Cell 2 has field labels ("Obra", "Fecha", "Recepción")
        // Row 1 Cell 3 has values ("V ORTIZ", "16-01-2023", "Bodega Coquimbo")
        
        let supplier = 'Desconocido';
        let date = '';
        let reference = '';
        let shippingAddress = '';
        
        // Find supplier name
        // We look in Row 1 Cell 1 paragraphs. The first paragraph is usually "Señores <Supplier>"
        const r1c1 = firstTable[0]?.[0] || [];
        for (const text of r1c1) {
            if (text.toLowerCase().includes('señores')) {
                supplier = text.replace(/señores/i, '').replace(/[^a-zA-Z\s-]/g, '').trim();
            }
        }
        
        // In case vendor wasn't identified in that cell, let's fallback to regex search on entire text
        if (supplier === 'Desconocido' || supplier === '') {
            const allText = xmlContent.replace(/<[^>]+>/g, ' ');
            const matchSupplier = allText.match(/se\s*ñ\s*o\s*r\s*e\s*s\s+([A-Z\s-]{3,30})/i);
            if (matchSupplier) {
                supplier = matchSupplier[1].trim();
            }
        }

        // Clean up supplier name (remove extra spaces/accents/special chars)
        supplier = supplier.replace(/\s+/g, ' ').trim();

        // Find Date, Project/Obra and Shipping Address
        // Row 1 Cell 2: ['Obra', 'Fecha', 'Recepción'] or similar
        // Row 1 Cell 3: ['ProjectName', 'DateString', 'AddressString'] or similar
        const r1c2 = firstTable[0]?.[1] || [];
        const r1c3 = firstTable[0]?.[2] || [];
        
        for (let i = 0; i < r1c2.length; i++) {
            const key = r1c2[i].toLowerCase();
            const val = r1c3[i] || '';
            if (key.includes('fecha')) {
                date = val.trim();
            } else if (key.includes('obra')) {
                reference = val.trim();
            } else if (key.includes('recep') || key.includes('bodega')) {
                shippingAddress = val.trim();
            }
        }

        // Fallback for metadata if cells are merged differently (e.g. SOLUEX uses 5 cells)
        // Let's search the table rows for label matching
        for (const row of firstTable) {
            for (let c = 0; c < row.length; c++) {
                const cell = row[c];
                for (let p = 0; p < cell.length; p++) {
                    const text = cell[p].toLowerCase();
                    if (text.includes('señores')) {
                        // The supplier could be in the same paragraph or next
                        supplier = cell[p].replace(/señores\s*/i, '').trim();
                        // If it has address next
                        if (cell[p+1] && cell[p+1].toLowerCase().includes('direcc')) {
                            // Already captured supplier name in paragraph 1
                        }
                    }
                    if (text.includes('fecha') && c + 1 < row.length) {
                        // Look at same paragraph index in next cell
                        date = row[c+1][p] || row[c+1][0] || date;
                    }
                    if (text.includes('obra') && c + 1 < row.length) {
                        reference = row[c+1][p] || row[c+1][0] || reference;
                    }
                    if ((text.includes('recep') || text.includes('bodega')) && c + 1 < row.length) {
                        shippingAddress = row[c+1][p] || row[c+1][0] || shippingAddress;
                    }
                }
            }
        }

        // Clean up supplier name extra text (like "Señores SOLUEX Direccion...")
        if (supplier.includes('\n')) {
            supplier = supplier.split('\n')[0];
        }
        // If supplier contains "Direccion" or "Atencion"
        const cleanSupplier = (name) => {
            let n = name;
            // Remove everything after Direccion, Atencion, etc.
            n = n.split(/direcc|atenc|tel/i)[0];
            // Remove non-word prefixes/suffixes
            n = n.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9\s.\-_]+$/g, '');
            return n.trim();
        };
        supplier = cleanSupplier(supplier);

        // Find Order Number from file content or filename
        // It's often in "ORDEN DE COMPRA N° XXXX"
        let orderNumber = '';
        const allDocText = xmlContent.replace(/<[^>]+>/g, ' ');
        const matchOrder = allDocText.match(/orden\s+de\s+compra\s+n\s*[°\.]?\s*(\d+)/i);
        if (matchOrder) {
            orderNumber = matchOrder[1];
        }

        // Parse items table
        // We look for a row where cell 1 contains "CANT." or "CNT."
        let itemsRowIndex = -1;
        for (let i = 0; i < firstTable.length; i++) {
            const row = firstTable[i];
            const cell1Text = row[0]?.[0]?.toLowerCase() || '';
            if (cell1Text.includes('cant') || cell1Text.includes('cnt.')) {
                itemsRowIndex = i + 1; // The items row is the next row (usually index 3, i.e. 4th row)
                break;
            }
        }

        const items = [];
        if (itemsRowIndex !== -1 && firstTable[itemsRowIndex]) {
            const itemRow = firstTable[itemsRowIndex];
            // Cell 1: Array of Quantities
            // Cell 2: Array of Units of Measure
            // Cell 3: Array of Descriptions
            const qtys = itemRow[0] || [];
            const units = itemRow[1] || [];
            const details = itemRow[2] || [];
            
            // Clean empty paragraphs in qtys/details to align them
            const cleanQtys = qtys.filter(q => q.trim() !== '');
            const cleanUnits = units.filter(u => u.trim() !== '');
            const cleanDetails = details.filter(d => d.trim() !== '');

            const count = Math.max(cleanQtys.length, cleanDetails.length);
            for (let i = 0; i < count; i++) {
                const qtyStr = cleanQtys[i] || '1';
                const qty = parseFloat(qtyStr.replace(',', '.')) || 1.0;
                const unit = cleanUnits[i] || 'UNIDADES';
                const detail = cleanDetails[i] || 'Producto sin detalle';

                items.push({
                    qty,
                    unit,
                    description: detail.replace(/\s+/g, ' ').trim()
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
        console.error('Error parsing DOCX:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = { parseDocx };
