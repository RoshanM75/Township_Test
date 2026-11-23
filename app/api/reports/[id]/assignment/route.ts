import { assignReport } from '@/lib/server/repository';
import { assignmentHistory, assignmentInput } from '@/lib/server/responsibilities';
import { apiError, json, readJson } from '@/lib/server/http';
import { validateReportId } from '@/lib/server/validation';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
    try {
        requireReviewer(request);
        const history = await assignmentHistory(requestArea(request), validateReportId((await params).id));
        return json({ history });
    } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: Context) {
    try {
        requireReviewer(request);
        const report = await assignReport(validateReportId((await params).id), requestArea(request),
            assignmentInput(await readJson(request)));
        return json({ report });
    } catch (error) { return apiError(error); }
}
