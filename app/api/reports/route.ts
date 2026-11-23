import { createReport, readReports } from '@/lib/server/repository';
import { apiError, json, readJson } from '@/lib/server/http';
import { RequestError, validateReport } from '@/lib/server/validation';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';

export async function GET(request: Request) {
    try {
        const search = new URL(request.url).searchParams;
        const status = search.get('status') ?? 'open';
        const forOperator = search.get('operator') === '1';
        if (forOperator) requireReviewer(request);
        if (!['open', 'all'].includes(status)) throw new RequestError('Status must be open or all.');
        return json({ reports: await readReports(status === 'all', requestArea(request), forOperator) });
    } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
    try { return json(await createReport(validateReport(await readJson(request))), 201); }
    catch (error) { return apiError(error); }
}
