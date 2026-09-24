import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { finite, timestamp, normalizeFacha, normalizeOpenWaters, mergeRows, fetchSnapshot, sampleStream } from '../lib/ais.js';

const vessel = { mmsi: 310123456, latitude: 32.3, longitude: -64.75, timestamp: '2026-09-24T17:00:00Z', name: 'TEST FIXTURE', heading: null, speedOverGround: 0 };
const msg = (patch = {}) => ({ MessageType: 'PositionReport', MetaData: { MMSI: 310123456, ShipName: 'TEST FIXTURE', time_utc: '2026-09-24 17:00:00.123456789 +0000 UTC' }, Message: { PositionReport: { UserID: 310123456, Latitude: 32.3, Longitude: -64.75, Sog: 0, Cog: 360, TrueHeading: 511, Valid: true, ...patch } } });
function socketFactory(frames = [], options = {}) {
  return class MockSocket extends EventEmitter {
    static instances = [];
    constructor() { super(); this.constructor.instances.push(this); queueMicrotask(() => this.emit('open')); }
    send(body) {
      this.subscription = JSON.parse(body);
      queueMicrotask(() => {
        for (const frame of frames) { if (!this.terminated) this.emit('message', typeof frame === 'string' ? frame : Buffer.from(JSON.stringify(frame))); }
        if (options.close && !this.terminated) this.emit('close', 1008, Buffer.from(options.close));
      });
    }
    terminate() { this.terminated = true; }
  };
}

test('unknown values stay unknown; zero is real; AIS sentinels are rejected', () => {
  assert.equal(finite(null), null); assert.equal(finite(''), null); assert.equal(finite(false), null); assert.equal(finite(0), 0);
  const r = normalizeFacha({ ...vessel, timestamp: 'invalid', courseOverGround: 360, heading: 511 });
  assert.equal(r.speed, 0); assert.equal(r.heading, null); assert.equal(r.course, null);
  assert.equal(r.last_position_UTC, null); assert.equal(r.age_s, null);
  assert.equal(timestamp('2026-09-24 17:00:00.123456789 +0000 UTC'), '2026-09-24T17:00:00.123Z');
});
test('invalid, missing, out-of-region and non-vessel positions do not reach Bermuda rows', () => {
  for (const patch of [{latitude:null},{longitude:''},{latitude:91},{mmsi:'invalid'},{latitude:38.7,longitude:-9.15}]) assert.equal(normalizeFacha({ ...vessel, ...patch }), null);
  const feature = { type:'Feature', geometry:{type:'Point',coordinates:[-64.75,32.3]}, properties:{mmsi:310123456,seen:vessel.timestamp,kind:'vessel'} };
  assert.equal(normalizeOpenWaters(feature).lat, 32.3);
  assert.equal(normalizeOpenWaters({...feature,properties:{...feature.properties,kind:'aton'}}),null);
});
test('merge uses source position time and fills only missing identity metadata', () => {
  const old = normalizeFacha({ ...vessel, timestamp:'2026-09-24T16:00:00Z' });
  const recent = normalizeFacha({ ...vessel, timestamp:'2026-09-24T17:00:00Z', name:'', latitude:32.4 });
  const unknown = normalizeFacha({ ...vessel, timestamp:null, latitude:32.5 });
  const [row] = mergeRows([[recent],[unknown,old]]);
  assert.equal(row.lat,32.4); assert.equal(row.name,'TEST FIXTURE'); assert.equal(row.last_position_UTC,'2026-09-24T17:00:00.000Z');
});
test('facha request uses accepted radius, retains HTTP reason and distinguishes malformed data from empty coverage', async () => {
  let requested;
  const ok = await fetchSnapshot('facha.dev',{fetchImpl:async url => { requested=url; return Response.json([vessel]); }});
  assert.match(requested,/\/30$/); assert.equal(ok.diag.count,1); assert.equal(ok.diag.httpStatus,200);
  const bad = await fetchSnapshot('facha.dev',{fetchImpl:async()=>Response.json({error:'Radius cannot be greater than 30km'},{status:400})});
  assert.match(bad.diag.error,/30km/); assert.equal(bad.diag.ok,false);
  const malformed = await fetchSnapshot('facha.dev',{fetchImpl:async()=>Response.json({unexpected:[]})});
  assert.equal(malformed.diag.status,'failed');
  const empty = await fetchSnapshot('facha.dev',{fetchImpl:async()=>Response.json([])});
  assert.equal(empty.diag.status,'empty-snapshot'); assert.equal(empty.diag.ok,true);
});
test('a silent open socket does not prove subscription or coverage, and is cleaned up', async () => {
  const WS=socketFactory();
  const {diag}=await sampleStream({apiKey:'test-secret',WebSocketImpl:WS,durationMs:15});
  assert.equal(diag.connected,true); assert.equal(diag.ok,false); assert.equal(diag.subscriptionConfirmed,false);
  assert.equal(diag.status,'subscription-unconfirmed'); assert.equal(WS.instances[0].terminated,true);
});
test('subscription acknowledgement with no vessel is a distinct, honest result', async () => {
  const WS=socketFactory([{MessageType:'SubscriptionConfirmation',Message:{CompressionEnabled:true}}]);
  const {diag,rows}=await sampleStream({apiKey:'test-secret',WebSocketImpl:WS,durationMs:15});
  assert.equal(diag.status,'no-positions-in-window'); assert.equal(diag.subscriptionConfirmed,true); assert.equal(diag.ok,true); assert.equal(rows.length,0);
});
test('binary positions and later static identity reach the same row without changing position time', async () => {
  const WS=socketFactory([msg(), {MessageType:'ShipStaticData',MetaData:{MMSI:310123456},Message:{ShipStaticData:{Name:'FIXTURE RENAMED',Type:70,CallSign:'TEST'}}}]);
  const updates=[];
  const {diag,rows}=await sampleStream({apiKey:'test-secret',WebSocketImpl:WS,durationMs:15,onRow:(r,e)=>updates.push({r,e})});
  assert.equal(diag.positionFrames,1); assert.equal(rows.length,1); assert.equal(rows[0].name,'FIXTURE RENAMED');
  assert.equal(rows[0].last_position_UTC,'2026-09-24T17:00:00.123Z'); assert.equal(rows[0].heading,null);
  assert.equal(updates[1].e.position,false); assert.equal(diag.subscriptionConfirmed,true);
});
test('reject malformed frames, invalid positions and wrong MMSIs in track samples', async () => {
  const wrong={...msg(),MetaData:{...msg().MetaData,MMSI:310654321}};
  const WS=socketFactory(['not json',msg({Latitude:91}),msg({Valid:false}),wrong,msg()]);
  const {diag,rows}=await sampleStream({apiKey:'test-secret',mmsi:'310123456',WebSocketImpl:WS,durationMs:15});
  assert.equal(diag.parseErrors,1); assert.equal(diag.rejected,3); assert.equal(rows.length,1);
  assert.deepEqual(WS.instances[0].subscription.FiltersShipMMSI,['310123456']);
});
test('upstream auth errors are failures, terminate promptly and cannot leak the key', async () => {
  const WS=socketFactory([{Error:'Invalid API key test-secret'}]);
  const {diag}=await sampleStream({apiKey:'test-secret',WebSocketImpl:WS,durationMs:1000});
  assert.equal(diag.status,'subscription-rejected'); assert.equal(diag.ok,false); assert.doesNotMatch(diag.error,/test-secret/);
  assert.equal(WS.instances[0].terminated,true);
});
test('early close and request cancellation finish and release sockets', async () => {
  const WS=socketFactory([],{close:'connection limit'});
  const {diag}=await sampleStream({apiKey:'test-secret',WebSocketImpl:WS,durationMs:1000});
  assert.equal(diag.status,'closed-early'); assert.equal(diag.closeCode,1008);
  const WS2=socketFactory(); const controller=new AbortController();
  const pending=sampleStream({apiKey:'test-secret',WebSocketImpl:WS2,signal:controller.signal,durationMs:1000});
  controller.abort();
  assert.equal((await pending).diag.status,'cancelled'); assert.equal(WS2.instances[0].terminated,true);
});
test('reference checks normalize remote data only in their explicitly separate scope', async () => {
  const lisbon={...vessel,latitude:38.7,longitude:-9.15};
  const fetchImpl=async()=>Response.json([lisbon]);
  assert.equal((await fetchSnapshot('facha.dev',{fetchImpl})).rows.length,0);
  const reference=await fetchSnapshot('facha.dev',{control:true,fetchImpl});
  assert.equal(reference.rows.length,1); assert.equal(reference.diag.scope,'reference-only');
});
