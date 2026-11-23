import { coverageByKind } from '@/lib/operator';
import { apiError, json, readJson } from '@/lib/server/http';
import { filterOperatorTargets, operatorTargets } from '@/lib/server/operator';
import { requestArea } from '@/lib/server/pilots';
import { saveResponsibility } from '@/lib/server/responsibilities';
import { requireReviewer } from '@/lib/server/reviewer';

export async function GET(request: Request) {
    try {
        requireReviewer(request);
        const { targets, as_of, dataset_id } = await operatorTargets(requestArea(request));
        const page = filterOperatorTargets(targets, new URL(request.url).searchParams, as_of);
        return json({ as_of, dataset_id, coverage: coverageByKind(targets, as_of), ...page });
    } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
    try {
        requireReviewer(request);
        return json({ responsibility: await saveResponsibility(requestArea(request), await readJson(request)) });
    } catch (error) { return apiError(error); }
}
