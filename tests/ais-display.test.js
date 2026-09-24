import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { renderVesselRows } from '../src/aisDisplay.ts';
import handler from '../api/ais-live.js';

test('raw provider -> deployed handler contract -> exact table formatter preserves identifiers, coordinates and unknown data', async () => {
  const originalFetch = globalThis.fetch, key = process.env.AISSTREAM_API_KEY;
  delete process.env.AISSTREAM_API_KEY;
  globalThis.fetch = async url => url.includes('facha.dev') ? Response.json([{ mmsi:310123456, name:'<TEST FIXTURE>', latitude:32.31, longitude:-64.76, timestamp:null, speedOverGround:0, heading:null, courseOverGround:null }]) : Response.json({type:'FeatureCollection',features:[]});
  const res=new EventEmitter(); res.setHeader=()=>{}; res.status=code=>{res.code=code;return res;};res.json=data=>{res.body=data;res.writableEnded=true;};
  try {
    await handler({query:{}},res);
    assert.equal(res.code,200);assert.equal(res.body.rows.length,1);assert.equal(res.body.status,'age-unknown');
    const html=renderVesselRows(res.body.rows);
    assert.match(html,/310123456/);assert.match(html,/32\.31000/);assert.match(html,/-64\.76000/);
    assert.match(html,/&lt;TEST FIXTURE&gt;/);assert.match(html,/<td>—<\/td><td>0\.0 kt<\/td><td>—°<\/td>/);
  } finally { globalThis.fetch=originalFetch; if(key===undefined)delete process.env.AISSTREAM_API_KEY;else process.env.AISSTREAM_API_KEY=key; }
});
test('reference control positions never become Bermuda table rows', async () => {
  const originalFetch = globalThis.fetch, key = process.env.AISSTREAM_API_KEY;
  delete process.env.AISSTREAM_API_KEY;
  globalThis.fetch = async url => url.includes('facha.dev') ? Response.json([{mmsi:263619000,name:'REFERENCE FIXTURE',latitude:38.7,longitude:-9.15,timestamp:'2026-09-24T17:00:00Z'}]) : Response.json({features:[]});
  const res=new EventEmitter();res.setHeader=()=>{};res.status=()=>res;res.json=data=>{res.body=data;res.writableEnded=true;};
  try {
    await handler({query:{control:'1'}},res);
    assert.equal(res.body.status,'reference-only');assert.equal(res.body.diagnostics[1].count,1);assert.deepEqual(res.body.rows,[]);
    assert.doesNotMatch(renderVesselRows(res.body.rows),/REFERENCE FIXTURE/);
  } finally {globalThis.fetch=originalFetch;if(key===undefined)delete process.env.AISSTREAM_API_KEY;else process.env.AISSTREAM_API_KEY=key;}
});
