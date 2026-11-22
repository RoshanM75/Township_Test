import { apiError } from '@/lib/server/http';
import { requestArea } from '@/lib/server/pilots';
import { RequestError } from '@/lib/server/validation';
import { parseWeatherWarnings, unavailableWarnings, warningUrl } from '@/lib/weather-warnings';

export async function GET(request: Request) {
    try {
        const area = requestArea(request);
        const response = await fetch(warningUrl(), { next: { revalidate: 120 }, signal: AbortSignal.timeout(5000) });
        return Response.json(response.ok ? parseWeatherWarnings(await response.json(), area) : unavailableWarnings());
    } catch (error) {
        if (error instanceof RequestError) return apiError(error);
        return Response.json(unavailableWarnings());
    }
}
