import { caseExportRow, checkExportRow, operatorCsv, selectPeriodCases, windowStart, type OperatorGeometry } from '@/lib/operator';
import { apiError } from '@/lib/server/http';
import { operatorReports, operatorTargets, periodDays } from '@/lib/server/operator';
import { pilotContext, requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';
import { RequestError } from '@/lib/server/validation';

const CASE_FIELDS = ['id','area_id','dataset_id','target_type','target_id','location','kind','severity','status','team','due_on',
    'work_order_ref','assignment_version','reported_at','checked_at','fixed_at','dismissed_at','estimated_cost_rm','latitude','longitude'] as const;
const CHECK_FIELDS = ['area_id','dataset_id','target_type','target_id','kind','name','team','responsibility_ref','check_status',
    'current_fields','required_fields','missing_fields','next_due','osm_attribution'] as const;

export async function GET(request: Request) {
    try {
        requireReviewer(request);
        const area = requestArea(request);
        const search = new URL(request.url).searchParams;
        const dataset = search.get('dataset') ?? 'cases', format = search.get('format') ?? 'csv';
        if (!['cases','checks'].includes(dataset) || !['csv','json','geojson'].includes(format)) {
            throw new RequestError('Choose a case or access check export in CSV, JSON or GeoJSON.');
        }
        const headers = { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="townshipgo-${area}-${dataset}.${format}"` };
        let asOf: string;
        let from: string | null = null;
        let datasetId: string;
        let rows: ReturnType<typeof caseExportRow>[] | ReturnType<typeof checkExportRow>[];
        let geometry: (OperatorGeometry | null)[];
        if (dataset === 'cases') {
            const days = periodDays(search);
            const [reports, context] = await Promise.all([operatorReports(area), pilotContext(area)]);
            asOf = new Date().toISOString();
            from = windowStart(asOf, days);
            datasetId = context.dataset_id;
            const selected = selectPeriodCases(reports, from, asOf);
            rows = selected.map(report => caseExportRow(report, area, datasetId));
            if (format === 'csv') return new Response(operatorCsv(CASE_FIELDS, rows), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
            geometry = selected.map(report => report.lat != null && report.lng != null ? { type: 'Point', coordinates: [report.lng, report.lat] } : null);
        } else {
            const snapshot = await operatorTargets(area);
            asOf = snapshot.as_of;
            datasetId = snapshot.dataset_id;
            rows = snapshot.targets.map(target => checkExportRow(target, area, datasetId));
            if (format === 'csv') return new Response(operatorCsv(CHECK_FIELDS, rows), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' } });
            geometry = snapshot.targets.map(target => target.geometry);
        }
        const metadata = { schema_version: 1, area_id: area, dataset_id: datasetId, dataset, as_of: asOf, from,
            attribution: '© OpenStreetMap contributors, ODbL. TownshipGo operator records.' };
        if (format === 'json') return Response.json({ ...metadata, rows }, { headers });
        return new Response(JSON.stringify({ type: 'FeatureCollection', ...metadata,
            features: rows.map((properties, index) => ({ type: 'Feature', properties, geometry: geometry[index] })) }),
        { headers: { ...headers, 'Content-Type': 'application/geo+json' } });
    } catch (error) { return apiError(error); }
}
