import assert from 'node:assert/strict';
import test from 'node:test';
import { caseExportRow, isOverdue, operatorActivity, operatorCsv, rankOpenCases, selectPeriodCases, targetCheck } from '../lib/operator.ts';

const at = '2026-11-23T16:15:00.000Z';
const report = (id, fields = {}) => ({ id, status: 'pending_capex_review', category: 'Access Barrier', severity: 'blocker',
    edge_id: 45, kind: 'blocked', created_at: '2026-11-20T02:00:00.000Z', ...fields });

test('operator activity counts events in their period and excludes dismissals from fixes and repeat locations', () => {
    const rows = [
        report('first', { responsible_team: 'Walkways', due_on: '2026-11-23',
            checked_at: '2026-11-20T04:00:00.000Z' }),
        report('second', { status: 'fixed', checked_at: '2026-11-20T06:00:00.000Z', fixed_at: '2026-11-21T02:00:00.000Z' }),
        report('dismissed', { status: 'fixed', dismissed_at: '2026-11-20T03:00:00.000Z' }),
        report('historic', { status: 'fixed', created_at: '2026-11-01T02:00:00.000Z', fixed_at: '2026-11-20T02:00:00.000Z' }),
        report('bench', { asset_id: '45', responsible_team: 'Parks' }),
    ];
    const value = operatorActivity(rows, 'pasar-seni', 7, at);
    assert.equal(value.reported, 4);
    assert.equal(value.checked, 2);
    assert.equal(value.fixed, 2);
    assert.equal(value.dismissed, 1);
    assert.equal(value.median_check_hours, 3);
    assert.equal(value.median_fix_hours, 240);
    assert.equal(value.overdue, 1);
    assert.equal(value.teams.find(team => team.team === 'Walkways').overdue, 1);
    assert.equal(value.hotspots.length, 1);
    assert.equal(value.hotspots[0].count, 2);
    assert.equal(value.hotspots[0].report_id, 'first');
    assert.equal(value.buckets.reduce((total, bucket) => total + bucket.reported, 0), 4);
    assert.equal(value.buckets.reduce((total, bucket) => total + bucket.fixed, 0), 2);
    assert.ok(selectPeriodCases(rows, value.from, at).some(row => row.id === 'historic'));
});

test('queue priority uses severity, deadlines and exact mapped target matches', () => {
    const rows = [report('comfort', { severity: 'comfort', due_on: '2026-11-21' }),
        report('fresh', { edge_id: 12 }), report('overdue', { due_on: '2026-11-23' }),
        report('related'), report('closed', { status: 'fixed', due_on: '2026-11-21' })];
    assert.deepEqual(rankOpenCases(rows, '2026-11-24').map(item => item.report.id), ['overdue', 'related', 'fresh', 'comfort']);
    assert.equal(isOverdue(rows[2], '2026-11-23'), false);
});

test('access coverage uses the latest evidence for each required field and surfaces expiry', () => {
    const base = { id: '1', target_type: 'entrance', target_id: '31', status: 'verified',
        observed_at: '2026-11-10T01:00:00.000Z', created_at: '2026-11-10T01:00:00.000Z', valid_until: '2026-12-01T00:00:00.000Z',
        reviewer: 'Audit team', method: 'site_visit', attributes: { available: false, path_connection: true, step_free: true, opening_hours: '24/7' } };
    assert.equal(targetCheck('entrance', '31', [base], at).status, 'current');
    assert.deepEqual(targetCheck('entrance', '31', [base, { ...base, id: '2', observed_at: '2026-11-22T00:00:00.000Z',
        valid_until: '2026-11-23T10:00:00.000Z', attributes: { step_free: false } }], at), {
        status: 'expired', current: 3, required: 4, missing: ['step_free'], next_due: base.valid_until,
    });
    assert.equal(targetCheck('entrance', '31', [{ ...base, attributes: { available: true } }], at).status, 'incomplete');
});

test('case exports omit free-text reports and neutralise spreadsheet formulas in shared fields', () => {
    const row = caseExportRow(report('4', { description: 'Private note', review_note: 'Private review',
        work_order_ref: '=​1+1', responsible_team: 'Parks, "A"', location_name: '  +name' }), 'pasar-seni', 'test-map');
    assert.equal(row.target_type, 'edge');
    assert.ok(!JSON.stringify(row).includes('Private'));
    const csv = operatorCsv(['id', 'work_order_ref', 'team', 'location'], [row]);
    assert.equal(csv, 'id,work_order_ref,team,location\r\n"4","\'=\u200B1+1","Parks, ""A""","\'  +name"\r\n');
});
