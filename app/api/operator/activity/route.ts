import { apiError, json } from '@/lib/server/http';
import { periodDays, readOperatorActivity } from '@/lib/server/operator';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';

export async function GET(request: Request) {
    try {
        requireReviewer(request);
        const area = requestArea(request);
        return json(await readOperatorActivity(area, periodDays(new URL(request.url).searchParams)));
    } catch (error) { return apiError(error); }
}
