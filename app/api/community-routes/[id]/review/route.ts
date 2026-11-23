import { apiError, json, readJson } from '@/lib/server/http';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';
import { communityId, reviewCommunityRoute } from '@/lib/server/community-routes';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireReviewer(request);
        const route = await reviewCommunityRoute(requestArea(request), communityId((await params).id), await readJson(request));
        return json({ route });
    } catch (error) { return apiError(error); }
}
