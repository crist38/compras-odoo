// Project tracking: computes the 5 progress tracks of each CRM opportunity
// (Técnico, Financiero, Producción, Despacho, Instalación) from Odoo data.

const TRACKS = [
    { key: 'tecnico', label: 'Técnico', steps: ['Sin medir', 'Medido', 'En revisión', 'Aprobado', 'Liberado'] },
    { key: 'financiero', label: 'Financiero', steps: ['Anticipo pendiente', 'Habilitado', 'Pago parcial', 'Saldo', 'Pagado'] },
    { key: 'produccion', label: 'Producción', steps: ['Sin liberar', 'Programado', 'Fabricación', 'Calidad', 'Terminado'] },
    { key: 'despacho', label: 'Despacho', steps: ['Pendiente', 'Programado', 'Parcial', 'Completo'] },
    { key: 'instalacion', label: 'Instalación', steps: ['No aplica', 'Pendiente', 'Programada', 'En ejecución', 'Recibida'] }
];

// Share of the order total that must be paid as advance to enable production
const ADVANCE_RATIO = 0.5;
// Amount tolerance (rounding) when comparing money
const MONEY_EPSILON = 1;

// CRM stages after "won" that mean the project is in production / finished
const STAGE_MANUFACTURING = /fabric|producci/i;
const STAGE_FINISHED = /finaliz|terminad|complet|cerrad/i;
const STAGE_LOST = /perd|lost|no califica|descart/i;
// Order lines that include installation (e.g. "... Con Instalación Incluida")
const INSTALLATION_LINE = /instalaci[oó]n/i;

const CONFIRMED_STATES = ['sale', 'done'];

const fmtMoney = (n) => `$${Math.round(n).toLocaleString('es-CL')}`;
const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const groupBy = (records, key) => {
    const map = new Map();
    for (const r of records) {
        const k = Array.isArray(r[key]) ? r[key][0] : r[key];
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
    }
    return map;
};

// Reads a model without failing the whole board when the user lacks access or the model doesn't exist
async function safeSearchRead(client, model, domain, fields, warnings, label) {
    try {
        return await client.executeKw(model, 'search_read', [domain], { fields });
    } catch (error) {
        warnings.push(`No se pudo leer ${label}: ${error.message.split('\n')[0]}`);
        return null;
    }
}

// Only request the fields this Odoo version actually has (e.g. planned_date_begin is Enterprise-only)
async function existingFields(client, model, wanted) {
    try {
        const fields = await client.executeKw(model, 'fields_get', [wanted], { attributes: ['type'] });
        return wanted.filter(f => fields[f]);
    } catch (error) {
        return [];
    }
}

// CRM stages shown on the board: the won stage and every later one, except "lost"-like stages
async function trackedStages(client) {
    const stages = await client.executeKw('crm.stage', 'search_read', [[]], {
        fields: ['id', 'name', 'sequence', 'is_won'],
        order: 'sequence asc, id asc'
    });
    const won = stages.filter(s => s.is_won);
    if (won.length === 0) return [];
    const minSequence = Math.min(...won.map(s => s.sequence));
    return stages.filter(s => s.is_won || (s.sequence >= minSequence && !STAGE_LOST.test(s.name)));
}

// ─── Track rules ────────────────────────────────────────────────────────

function technicalTrack({ attachmentCount, confirmed, drafts, productions }) {
    const released = productions.filter(mo => mo.state !== 'draft');
    if (released.length > 0) {
        return { step: 4, detail: `Liberado a fabricación: ${plural(released.length, 'orden', 'órdenes')} de fabricación.` };
    }
    if (confirmed.length > 0) {
        return { step: 3, detail: `Cotización ${confirmed.map(o => o.name).join(', ')} confirmada por el cliente.` };
    }
    if (drafts.length > 0) {
        return { step: 2, detail: `Cotización ${drafts.map(o => o.name).join(', ')} en revisión (borrador o enviada).` };
    }
    if (attachmentCount > 0) {
        return { step: 1, detail: `${plural(attachmentCount, 'documento adjunto', 'documentos adjuntos')} en la oportunidad (medidas / presupuesto).` };
    }
    return { step: 0, detail: 'La oportunidad no tiene documentos ni cotización.' };
}

function financialTrack({ confirmed, invoices }) {
    if (confirmed.length === 0) {
        return { step: 0, detail: 'Sin pedido de venta confirmado.' };
    }
    if (invoices === null) {
        return { step: 0, detail: 'Sin acceso a la facturación de Odoo.' };
    }
    const total = confirmed.reduce((s, o) => s + o.amount_total, 0);
    const toInvoice = confirmed.reduce((s, o) => s + (o.amount_to_invoice || 0), 0);
    const sign = (inv) => (inv.move_type === 'out_refund' ? -1 : 1);
    const invoicePaid = invoices.reduce((s, inv) => s + sign(inv) * (inv.amount_total - inv.amount_residual), 0);
    const transactionsPaid = confirmed.reduce((s, o) => s + (o.amount_paid || 0), 0);
    const paid = Math.max(invoicePaid, transactionsPaid);
    const open = invoices.reduce((s, inv) => s + sign(inv) * inv.amount_residual, 0);
    const advance = total * ADVANCE_RATIO;
    const summary = `Pagado ${fmtMoney(paid)} de ${fmtMoney(total)}.`;

    if (total > 0 && paid >= total - MONEY_EPSILON) {
        return { step: 4, detail: `Pagado completo: ${fmtMoney(total)}.` };
    }
    if (toInvoice <= MONEY_EPSILON && open > MONEY_EPSILON) {
        return { step: 3, detail: `Saldo facturado por cobrar: ${fmtMoney(open)}. ${summary}` };
    }
    if (paid > advance + MONEY_EPSILON) {
        return { step: 2, detail: summary };
    }
    if (paid >= advance - MONEY_EPSILON && paid > 0) {
        return { step: 1, detail: `Anticipo pagado (${Math.round(ADVANCE_RATIO * 100)}%). ${summary}` };
    }
    return {
        step: 0,
        detail: paid > 0
            ? `Anticipo incompleto: se requiere ${fmtMoney(advance)} (${Math.round(ADVANCE_RATIO * 100)}%). ${summary}`
            : `Anticipo de ${fmtMoney(advance)} (${Math.round(ADVANCE_RATIO * 100)}%) sin pagar.`
    };
}

function productionTrack({ productions, workorders }) {
    const active = productions.filter(mo => mo.state !== 'cancel');
    const released = active.filter(mo => mo.state !== 'draft');
    if (released.length === 0) {
        return {
            step: 0,
            detail: active.length > 0
                ? `${plural(active.length, 'orden de fabricación', 'órdenes de fabricación')} en borrador.`
                : 'Sin órdenes de fabricación.'
        };
    }
    const done = active.filter(mo => mo.state === 'done').length;
    const toClose = active.filter(mo => mo.state === 'to_close').length;
    const counts = `${done} de ${active.length} OF terminadas`;
    if (done === active.length) {
        return { step: 4, detail: `${plural(done, 'orden de fabricación terminada', 'órdenes de fabricación terminadas')}.` };
    }
    if (done + toClose === active.length) {
        return { step: 3, detail: `${counts}; ${toClose} por revisar y cerrar.` };
    }
    const operationsDone = workorders.filter(wo => wo.state === 'done').length;
    const started = active.some(mo => ['progress', 'to_close', 'done'].includes(mo.state))
        || workorders.some(wo => ['progress', 'done'].includes(wo.state));
    if (started) {
        return { step: 2, detail: `${counts}; ${operationsDone} de ${workorders.length} operaciones de taller hechas.` };
    }
    const starts = released.map(mo => mo.date_start).filter(Boolean).sort();
    return {
        step: 1,
        detail: `${plural(released.length, 'orden confirmada', 'órdenes confirmadas')}${starts.length ? `, inicio programado ${fmtDate(starts[0])}` : ''}.`
    };
}

function dispatchTrack({ pickings }) {
    const deliveries = pickings.filter(p => p.picking_type_code === 'outgoing' && p.state !== 'cancel');
    if (deliveries.length === 0) {
        return { step: 0, detail: 'Sin entregas generadas.' };
    }
    const done = deliveries.filter(p => p.state === 'done');
    if (done.length === deliveries.length) {
        const last = done.map(p => p.date_done).filter(Boolean).sort().pop();
        return { step: 3, detail: `Entregado${last ? ` el ${fmtDate(last)}` : ''}.` };
    }
    if (done.length > 0) {
        return { step: 2, detail: `${done.length} de ${deliveries.length} entregas realizadas.` };
    }
    const ready = deliveries.filter(p => p.state === 'assigned');
    if (ready.length > 0) {
        const date = ready.map(p => p.scheduled_date).filter(Boolean).sort()[0];
        return { step: 1, detail: `Listo para despachar${date ? `, programado para ${fmtDate(date)}` : ''}.` };
    }
    return { step: 0, detail: 'Entrega en espera (productos aún no disponibles).' };
}

function installationTrack({ confirmed, installationLines, tasks }) {
    if (confirmed.length === 0) {
        return { step: 0, detail: 'Sin pedido de venta confirmado (no se sabe si incluye instalación).' };
    }
    const active = tasks.filter(t => t.state !== '1_canceled');
    if (installationLines === 0 && active.length === 0) {
        return { step: 0, detail: 'El pedido no incluye instalación.' };
    }
    if (active.length === 0) {
        return { step: 1, detail: `Incluye instalación (${plural(installationLines, 'línea', 'líneas')}); sin tarea programada.` };
    }
    const isDone = (t) => t.state === '1_done' || t.is_closed;
    if (active.every(isDone)) {
        return { step: 4, detail: `Instalación recibida (${plural(active.length, 'tarea cerrada', 'tareas cerradas')}).` };
    }
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const open = active.filter(t => !isDone(t));
    const startOf = (t) => t.planned_date_begin || t.planned_date_start || null;
    if (open.some(t => startOf(t) && startOf(t) <= now)) {
        return { step: 3, detail: `Instalación en curso: ${open.length} de ${active.length} tareas abiertas.` };
    }
    const dates = open.map(t => startOf(t) || t.date_deadline).filter(Boolean).sort();
    if (dates.length > 0) {
        return { step: 2, detail: `Instalación programada para ${fmtDate(dates[0])}.` };
    }
    return { step: 1, detail: `${plural(open.length, 'tarea de instalación', 'tareas de instalación')} sin fecha.` };
}

// The CRM stage acts as a minimum: a lead moved to "En Fabricación" / "FINALIZADOS" by hand
// keeps at least that progress even if the linked documents are missing in Odoo.
function applyStageFloor(tracks, stageName) {
    const floor = (key, step) => {
        const track = tracks[key];
        if (track.step < step) {
            tracks[key] = { step, fromStage: true, detail: `Según la etapa del CRM «${stageName}». ${track.detail}` };
        }
    };
    if (STAGE_FINISHED.test(stageName)) {
        floor('tecnico', 4);
        floor('financiero', 4);
        floor('produccion', 4);
        floor('despacho', 3);
        if (tracks.instalacion.step > 0) floor('instalacion', 4);
    } else if (STAGE_MANUFACTURING.test(stageName)) {
        floor('tecnico', 4);
        floor('produccion', 2);
    }
}

// ─── Data loading ───────────────────────────────────────────────────────

// Sales orders of each lead: through opportunity_id (sale_crm), the source document (origin)
// or an order number written in the lead's name (e.g. "S00572 - Roberto Ramirez")
async function findLeadOrders(client, leads) {
    if (leads.length === 0) return new Map();
    const leadNames = [...new Set(leads.map(l => l.name))];
    const namedOrders = [...new Set(leads.flatMap(l => l.name.match(/\bS\d{4,}\b/g) || []))];
    const fields = ['id', 'name', 'state', 'origin', 'opportunity_id', 'amount_total', 'amount_to_invoice', 'amount_paid',
        'invoice_ids', 'picking_ids', 'mrp_production_ids', 'tasks_ids', 'date_order'];
    const available = await existingFields(client, 'sale.order', fields);
    const orders = await client.executeKw('sale.order', 'search_read', [[
        ['state', '!=', 'cancel'],
        '|', '|',
        ['opportunity_id', 'in', leads.map(l => l.id)],
        ['origin', 'in', leadNames],
        ['name', 'in', namedOrders]
    ]], { fields: available, order: 'id asc' });

    const byLead = new Map(leads.map(l => [l.id, []]));
    for (const so of orders) {
        const linked = leads.filter(l =>
            (so.opportunity_id && so.opportunity_id[0] === l.id) ||
            (!so.opportunity_id && (so.origin === l.name || new RegExp(`\\b${so.name}\\b`).test(l.name))));
        for (const lead of linked) byLead.get(lead.id).push(so);
    }
    return byLead;
}

async function buildTrackingBoard(client, { search = '', stageId = null } = {}) {
    const warnings = [];
    const stages = await trackedStages(client);
    if (stages.length === 0) {
        return { tracks: TRACKS, stages: [], leads: [], warnings: ['No hay una etapa del CRM marcada como ganada.'] };
    }

    const domain = [['stage_id', 'in', stageId ? [stageId] : stages.map(s => s.id)]];
    if (search) {
        domain.push('|', '|', ['name', 'ilike', search], ['partner_id.name', 'ilike', search], ['partner_name', 'ilike', search]);
    }
    const leads = await client.executeKw('crm.lead', 'search_read', [domain], {
        fields: ['id', 'name', 'partner_id', 'partner_name', 'stage_id', 'user_id', 'expected_revenue', 'date_closed', 'tag_ids'],
        order: 'date_closed desc, id desc',
        limit: 100
    });
    const leadIds = leads.map(l => l.id);

    const [ordersByLead, attachments] = await Promise.all([
        findLeadOrders(client, leads),
        leadIds.length === 0 ? [] : client.executeKw('ir.attachment', 'search_read', [
            [['res_model', '=', 'crm.lead'], ['res_id', 'in', leadIds]]
        ], { fields: ['res_id'] })
    ]);
    const attachmentsByLead = groupBy(attachments, 'res_id');

    const allOrders = [...ordersByLead.values()].flat();
    const confirmedOrders = allOrders.filter(o => CONFIRMED_STATES.includes(o.state));
    const ids = (field) => [...new Set(confirmedOrders.flatMap(o => o[field] || []))];
    const confirmedIds = confirmedOrders.map(o => o.id);
    const taskFields = await existingFields(client, 'project.task',
        ['id', 'state', 'is_closed', 'date_deadline', 'planned_date_begin', 'planned_date_start']);

    const [invoices, productions, pickings, tasks, installationLines] = await Promise.all([
        ids('invoice_ids').length === 0 ? [] : safeSearchRead(client, 'account.move',
            [['id', 'in', ids('invoice_ids')], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']]],
            ['id', 'move_type', 'amount_total', 'amount_residual'], warnings, 'las facturas'),
        ids('mrp_production_ids').length === 0 ? [] : safeSearchRead(client, 'mrp.production',
            [['id', 'in', ids('mrp_production_ids')]], ['id', 'state', 'date_start'], warnings, 'las órdenes de fabricación'),
        ids('picking_ids').length === 0 ? [] : safeSearchRead(client, 'stock.picking',
            [['id', 'in', ids('picking_ids')]], ['id', 'state', 'picking_type_code', 'scheduled_date', 'date_done'], warnings, 'las entregas'),
        ids('tasks_ids').length === 0 ? [] : safeSearchRead(client, 'project.task',
            [['id', 'in', ids('tasks_ids')]], taskFields, warnings, 'las tareas de instalación'),
        confirmedIds.length === 0 ? [] : safeSearchRead(client, 'sale.order.line',
            [['order_id', 'in', confirmedIds], ['name', 'ilike', 'instalaci']], ['order_id', 'name'], warnings, 'las líneas de venta')
    ]);
    const productionIds = (productions || []).map(mo => mo.id);
    const workorders = productionIds.length === 0 ? [] : (await safeSearchRead(client, 'mrp.workorder',
        [['production_id', 'in', productionIds]], ['production_id', 'state'], warnings, 'las operaciones de taller')) || [];

    const pick = (records, idList) => {
        const set = new Set(idList);
        return (records || []).filter(r => set.has(r.id));
    };
    const linesByOrder = groupBy((installationLines || []).filter(l => INSTALLATION_LINE.test(l.name)), 'order_id');
    const workordersByProduction = groupBy(workorders, 'production_id');

    const result = leads.map(lead => {
        const orders = ordersByLead.get(lead.id) || [];
        const confirmed = orders.filter(o => CONFIRMED_STATES.includes(o.state));
        const drafts = orders.filter(o => !CONFIRMED_STATES.includes(o.state));
        const leadProductions = pick(productions, confirmed.flatMap(o => o.mrp_production_ids || []));
        const ctx = {
            attachmentCount: (attachmentsByLead.get(lead.id) || []).length,
            confirmed,
            drafts,
            productions: leadProductions,
            workorders: leadProductions.flatMap(mo => workordersByProduction.get(mo.id) || []),
            invoices: invoices === null ? null : pick(invoices, confirmed.flatMap(o => o.invoice_ids || [])),
            pickings: pick(pickings, confirmed.flatMap(o => o.picking_ids || [])),
            tasks: pick(tasks, confirmed.flatMap(o => o.tasks_ids || [])),
            installationLines: confirmed.reduce((n, o) => n + (linesByOrder.get(o.id) || []).length, 0)
        };
        const tracks = {
            tecnico: technicalTrack(ctx),
            financiero: financialTrack(ctx),
            produccion: productionTrack(ctx),
            despacho: dispatchTrack(ctx),
            instalacion: installationTrack(ctx)
        };
        const stageName = lead.stage_id ? lead.stage_id[1] : '';
        applyStageFloor(tracks, stageName);

        return {
            id: lead.id,
            name: lead.name,
            partner: lead.partner_id ? lead.partner_id[1] : (lead.partner_name || ''),
            stage: stageName,
            salesperson: lead.user_id ? lead.user_id[1] : '',
            expectedRevenue: lead.expected_revenue,
            dateClosed: lead.date_closed,
            orders: orders.map(o => ({ id: o.id, name: o.name, state: o.state, amount: o.amount_total })),
            tracks: TRACKS.map(t => ({ key: t.key, ...tracks[t.key] }))
        };
    });

    return {
        tracks: TRACKS,
        stages: stages.map(s => ({ id: s.id, name: s.name })),
        leads: result,
        warnings
    };
}

module.exports = { TRACKS, buildTrackingBoard };
