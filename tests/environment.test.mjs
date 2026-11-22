import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentSegments, environmentCoverage } from '../lib/environment.ts';
import { edges, record, AT } from './helpers/journey-fixture.mjs';

test('the information network excludes carriageways and prohibited foot access', () => {
    const input=[...edges,{...edges[0],id:99,kind:'street'},{...edges[0],id:100,pedestrian_access:false}];
    assert.deepEqual(environmentSegments(input,[],AT,'paths').map(s=>s.id),edges.map(e=>e.id));
});

test('missing environment values stay unknown rather than borrowing routing assumptions', () => {
    const unknown=edges.map(e=>({...e,covered:null,shade_morning:null,lit_ratio:null}));
    for(const layer of ['shade','cover','lighting','observations']){
        const result=environmentSegments(unknown,[],AT,layer);
        assert.ok(result.every(s=>s.value===null&&s.source==='unknown'));
        assert.equal(environmentCoverage(result).known,0);
    }
    assert.equal(environmentCoverage(environmentSegments(unknown,[],AT,'paths')).known,3);
});

test('zero shade/light and explicitly absent cover are information, not missing values', () => {
    const data=edges.map(e=>({...e,covered:false,shade_morning:0,lit_ratio:0}));
    for(const layer of ['shade','cover','lighting']){
        const result=environmentSegments(data,[],AT,layer);
        assert.ok(result.every(s=>s.value!==null&&s.source===(layer==='shade'?'modelled':'mapped')));
        assert.equal(environmentCoverage(result).known,3);
        assert.equal(environmentCoverage(result).checked,0);
    }
});

test('an expired condition cannot be rescued by an older map value or audit', () => {
    const records=[record('path',1,{covered:true}),record('path',1,{covered:false},
        {observed_at:'2026-11-15T00:00:00Z',valid_until:'2026-11-16T00:00:00Z'})];
    const result=environmentSegments(edges,records,AT,'cover');
    assert.equal(result[0].source,'expired');assert.equal(result[0].value,null);
    assert.equal(environmentCoverage(result).expired,1);
});

test('reported information remains distinct from checked observations', () => {
    const records=[record('path',1,{shade_morning:.8},{status:'reported'})];
    const result=environmentSegments(edges,records,AT,'shade');
    assert.equal(result[0].source,'reported');assert.equal(result[0].value,.8);
    assert.equal(environmentCoverage(result).checked,0);
    assert.equal(environmentSegments(edges,records,AT,'observations')[0].value,null);
});

test('the field-observation layer states negative values and does not certify the whole path', () => {
    const result=environmentSegments(edges,[record('path',1,{path_open:false})],AT,'observations');
    assert.equal(result[0].source,'checked');assert.match(result[0].detail,/Path open: No/);
    assert.match(result[0].detail,/Other conditions may remain unknown/);
});

test('night-time shade is not substituted from a daylight value', () => {
    const result=environmentSegments(edges,[],'2026-11-17T13:00:00Z','shade');
    assert.ok(result.every(s=>s.value===null));assert.match(result[0].detail,/daylight/);
    assert.equal(environmentCoverage(environmentSegments(edges,[],'2026-11-17T13:00:00Z','lighting')).known,3);
});

test('crossing observations only apply to the matching target type', () => {
    const crossing=[{...edges[0],is_crossing:true,covered:null}];
    const wrong=record('path',1,{covered:true}),right=record('crossing',1,{covered:false});
    assert.equal(environmentSegments(crossing,[wrong],AT,'cover')[0].value,null);
    assert.equal(environmentSegments(crossing,[wrong,right],AT,'cover')[0].value,false);
    assert.equal(environmentSegments(crossing,[wrong,right],AT,'cover')[0].source,'checked');
});
