import { reviewReport } from '@/lib/server/repository';
import { apiError, json, readJson } from '@/lib/server/http';
import { validateReportCheck, validateReportId } from '@/lib/server/validation';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireReviewer(request);
        const report = await reviewReport(validateReportId((await params).id), requestArea(request),
            validateReportCheck(await readJson(request)));
        return json({ report });
    } catch (error) { return apiError(error); }
}
