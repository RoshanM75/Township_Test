import { apiError, json, readJson } from '@/lib/server/http';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';
import { communityId, readCommunityRoutes, submitCommunityRoute } from '@/lib/server/community-routes';

export async function GET(request: Request) {
    try {
        const search = new URL(request.url).searchParams;
        const reviewer = search.get('review') === '1';
        if (reviewer) requireReviewer(request);
        const receipt = search.get('receipt');
        const id = search.get('id');
        const routes = await readCommunityRoutes(requestArea(request), reviewer, receipt ? communityId(receipt) : undefined, id ? communityId(id) : undefined);
        return json({ routes });
    } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
    try {
        return json({ route: await submitCommunityRoute(requestArea(request), await readJson(request)) }, 201);
    } catch (error) { return apiError(error); }
}
