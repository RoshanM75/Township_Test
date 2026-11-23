import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { RequestError } from './validation.ts';

export function requireReviewer(request: Request) {
    const key = process.env.TOWNSHIP_REVIEW_KEY?.trim();
    if (!key) throw new RequestError('Reviewer access is not configured on this server.', 503);
    const token = request.headers.get('authorization') ?? '';
    const expected = Buffer.from(`Bearer ${key}`);
    const supplied = Buffer.from(token);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        throw new RequestError('Enter the reviewer key to change shared records.', 401);
    }
}
