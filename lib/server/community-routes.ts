import 'server-only';
import { getPool } from './postgres.ts';
import { pilotContext } from './pilots.ts';
import { readGraph } from './repository.ts';
import { RequestError } from './validation.ts';
import { openingAt } from '../verification.ts';
import { pointInPilot, type PilotId } from '../pilots.ts';
import { matchCommunityPath, MAX_COMMUNITY_POINTS, GUIDE_KINDS, type RoutePoint } from '../community-routes.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIELDS = `id, area_id, dataset_id, title, notes, status, matched_path AS path, created_at, published_at,
    checked_at, valid_until, opening_hours, reviewer, review_note, guide_kind`;

export function communityId(value: unknown) {
    if (typeof value !== 'string' || !UUID.test(value)) throw new RequestError('The route identifier is invalid.');
    return value.toLowerCase();
}

export async function readCommunityRoutes(area: PilotId, reviewer: boolean, receipt?: string, id?: string) {
    const { rows } = await getPool().query(`SELECT ${FIELDS}${reviewer ? ', points' : ''},
        COALESCE((SELECT jsonb_agg(to_jsonb(events) ORDER BY events.checked_at DESC,events.id DESC)
            FROM (SELECT id,action,reviewer,note,checked_at,opening_hours,valid_until FROM community_route_reviews
                WHERE route_id=community_routes.id ORDER BY checked_at DESC,id DESC LIMIT 20) events),'[]'::jsonb) AS reviews
        FROM community_routes
        WHERE area_id=$1 AND ($2 OR status IN ('published','verified') OR submission_id=$3)
        ORDER BY (coalesce(id=$4, false) OR coalesce(submission_id=$3, false)) DESC, created_at DESC LIMIT 100`, [area, reviewer, receipt ?? null, id ?? null]);
    return rows;
}

export async function submitCommunityRoute(area: PilotId, value: unknown) {
    const body = value as Record<string, unknown> | null;
    const submission = communityId(body?.submission_id);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    if (!title || title.length > 100 || notes.length > 800) throw new RequestError('Enter a route name and notes of up to 800 characters.');
    const guide = body?.guide_kind ?? 'general';
    if (!GUIDE_KINDS.includes(guide as typeof GUIDE_KINDS[number])) throw new RequestError('Choose a supported local guide type.');
    const points = body?.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > MAX_COMMUNITY_POINTS || points.some(point =>
        !Array.isArray(point) || point.length !== 2 || !point.every(x => typeof x === 'number' && Number.isFinite(x)) ||
        !pointInPilot(point as RoutePoint, area))) {
        throw new RequestError('Choose two or more public waypoints within the current walking area.');
    }
    if (body?.public_ends !== true) throw new RequestError('Confirm that the selected waypoints are public.');
    const context = await pilotContext(area);
    if (body.dataset_id !== context.dataset_id) throw new RequestError('Refresh the map before sharing this walk.', 409);
    const pool = getPool();
    const existing = await pool.query(`SELECT ${FIELDS} FROM community_routes WHERE area_id=$1 AND submission_id=$2`, [area, submission]);
    if (existing.rows[0]) return existing.rows[0];
    const { nodes, edges } = await readGraph(area);
    const path = matchCommunityPath(nodes, edges, points);
    const { rows } = await pool.query(`INSERT INTO community_routes (area_id, dataset_id, submission_id, title, notes, points, matched_path,guide_kind)
        VALUES ($1, $2, $3, $4, $5, $6, $7,$8)
        ON CONFLICT (area_id, submission_id) DO UPDATE SET submission_id=EXCLUDED.submission_id
        RETURNING ${FIELDS}`, [area, context.dataset_id, submission, title, notes, JSON.stringify(points), path ? JSON.stringify(path) : null,guide]);
    return rows[0];
}

export async function reviewCommunityRoute(area: PilotId, id: string, value: unknown) {
    const body = value as Record<string, unknown> | null;
    const action = body?.action;
    const reviewer = typeof body?.reviewer === 'string' ? body.reviewer.trim() : '';
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (action !== 'publish' && action !== 'verify' && action !== 'decline') throw new RequestError('Choose a review action.');
    if (!reviewer || reviewer.length > 120 || !note || note.length > 800) throw new RequestError('Enter the reviewer team and what it checked.');
    if (action === 'verify' && body?.field_checked !== true) {
        throw new RequestError('Confirm that the public route was inspected in person.');
    }
    const hours = typeof body?.opening_hours === 'string' ? body.opening_hours.trim() : '';
    if (action === 'verify' && (!hours || hours.length > 160 || openingAt(hours, new Date().toISOString()) === null || hours === 'closed' || hours === 'off')) {
        throw new RequestError('Enter the checked public access hours, such as 24/7 or Mo-Fr 08:00-18:00.');
    }
    const context = await pilotContext(area);
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const { rows: [route] } = await client.query(`SELECT ${FIELDS} FROM community_routes
            WHERE id=$1 AND area_id=$2 FOR UPDATE`, [id, area]);
        if (!route) throw new RequestError('The community route was not found.', 404);
        if (action !== 'decline' && (route.dataset_id !== context.dataset_id || !route.path)) {
            throw new RequestError('A disconnected or outdated proposal needs its missing paths mapped before it can be published.', 422);
        }
        const status = { publish: 'published', verify: 'verified', decline: 'declined' }[action];
        if (route.status === 'declined' && status !== 'declined') throw new RequestError('Ask the contributor to submit an updated route.', 409);
        if ((action === 'publish' && route.published_at) || (action === 'decline' && route.status === 'declined')) {
            await client.query('COMMIT');
            return route;
        }
        if (action === 'verify' && !route.published_at) throw new RequestError('Publish the screened suggestion before recording a field check.', 409);
        const { rows } = await client.query(`UPDATE community_routes SET status=$2, reviewer=$3, review_note=$4,
            published_at=CASE WHEN $2='published' THEN NOW() ELSE published_at END,
            checked_at=CASE WHEN $2='verified' THEN NOW() ELSE checked_at END,
            valid_until=CASE WHEN $2='verified' THEN NOW()+INTERVAL '90 days' ELSE NULL END,
            opening_hours=CASE WHEN $2='verified' THEN $5 ELSE opening_hours END
            WHERE id=$1 RETURNING ${FIELDS}`, [id, status, reviewer, note, hours]);
        await client.query(`INSERT INTO community_route_reviews(route_id,action,reviewer,note,opening_hours,valid_until)
            VALUES($1,$2,$3,$4,$5,$6)`,[id,action,reviewer,note,action==='verify'?hours:null,rows[0].valid_until]);
        const history=(await client.query(`SELECT action,reviewer,note,checked_at,opening_hours,valid_until FROM community_route_reviews
            WHERE route_id=$1 ORDER BY checked_at DESC,id DESC LIMIT 20`,[id])).rows;
        await client.query('COMMIT');
        return {...rows[0],reviews:history};
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
