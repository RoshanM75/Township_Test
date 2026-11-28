import assert from 'node:assert/strict';
import test from 'node:test';
import {panelTap,panelStep,panelDrag,routeChoiceGroups} from '../lib/resident-presentation.ts';

test('one tap opens a peek and minimises either expanded sheet position',()=>{
    assert.equal(panelTap('min'),'open');
    assert.equal(panelTap('open'),'min');
    assert.equal(panelTap('full'),'min');
});
test('the sheet has three predictable arrow/drag positions and ignores tiny drags',()=>{
    assert.equal(panelStep('min','up'),'open');
    assert.equal(panelStep('open','up'),'full');
    assert.equal(panelStep('full','down'),'open');
    assert.equal(panelDrag('full',120),'min');
    assert.equal(panelDrag('full',50),'open');
    assert.equal(panelDrag('open',45),'min');
    assert.equal(panelDrag('open',-45),'full');
    assert.equal(panelDrag('min',-5),null);
});
test('identical walking paths are grouped for display, without dropping any route mode',()=>{
    const route={coordinates:[[3,101],[3.1,101.01]],entrance:{id:'gate-a'},rest_stops:[]};
    const detour={...route,coordinates:[[3,101],[3.03,101],[3.1,101.01]]};
    const routes={direct:route,coolest:route,sheltered:detour,safest:route};
    const modes=['direct','coolest','sheltered','safest'];
    const grouped=routeChoiceGroups(routes,modes,'direct','direct','direct');
    assert.deepEqual(grouped.lead,['direct','sheltered']);
    assert.deepEqual(grouped.more,['coolest','safest']);
    const chosen=routeChoiceGroups(routes,modes,'safest','direct','direct');
    assert.ok(chosen.lead.includes('safest'));
    assert.deepEqual(new Set([...chosen.lead,...chosen.more]),new Set(modes));
});
test('different arrival or rest opportunities are not hidden as identical routes',()=>{
    const route={coordinates:[[3,101],[3.1,101.01]],entrance:{id:'a'},rest_stops:[]};
    const routes={direct:route,coolest:{...route,entrance:{id:'b'}},sheltered:{...route,rest_stops:[{id:'seat'}]}};
    assert.equal(routeChoiceGroups(routes,['direct','coolest','sheltered'],'direct','direct').lead.length,3);
});
