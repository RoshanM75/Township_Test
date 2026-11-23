import { reviewReport } from '@/lib/server/repository';
import { apiError, json } from '@/lib/server/http';
import { validateReportId } from '@/lib/server/validation';
import { requestArea } from '@/lib/server/pilots';
import { requireReviewer } from '@/lib/server/reviewer';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try { requireReviewer(request); return json({ report: await reviewReport(validateReportId((await params).id),requestArea(request)) }); }
    catch (error) { return apiError(error); }
}
