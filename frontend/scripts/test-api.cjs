/* Tests the real API module without requiring a browser or a backend.
 * npm run test:api. Network is deliberately mocked; this is NOT an integration test.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/api.ts'),'utf8'), {
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText;
const store = new Map(), notices=[];
let handler=async()=>new Response('{}',{status:200});
const context={exports:{},require,Headers,FormData,Blob,File,AbortController,URL,URLSearchParams,
  Response,Event,Intl,Date,console,setTimeout,clearTimeout,
  localStorage:{getItem:key=>store.get(key)||null,setItem:(key,v)=>store.set(key,v),removeItem:key=>store.delete(key)},
  window:{dispatchEvent:event=>notices.push(event.type)},fetch:(...args)=>handler(...args)};
vm.runInNewContext(code,context,{filename:'api.ts'});
const {api,session,request,toBeijingInstant,dayText,nextDay,authorizedBlob} = context.exports;
const account={token:'local-test-token',username:'test',role:'ADMIN',expiresAt:'2999-01-01T00:00:00Z'};
let count=0;
async function check(name,fn){await fn();console.log('PASS '+name);count++}
async function main(){
 await check('session serializes and clears',()=>{session.set(account);assert.equal(session.get().token,account.token);session.clear();assert.equal(session.get(),null)});
 await check('expired token not reused',()=>{session.set({...account,expiresAt:'2000-01-01T00:00:00Z'});assert.equal(session.get(),null);assert.equal(store.size,0)});
 await check('corrupt storage is safe',()=>{store.set('zaoyan-session','{');assert.equal(session.get(),null);session.clear()});
 await check('Beijing minute and second input convert to UTC independently of host timezone',()=>{assert.equal(toBeijingInstant('2026-10-15T19:30'),'2026-10-15T11:30:00.000Z');assert.equal(toBeijingInstant('2026-10-15T00:00:15'),'2026-10-14T16:00:15.000Z')});
 await check('invalid date input rejected',()=>{assert.throws(()=>toBeijingInstant(''),/北京时间/);assert.throws(()=>toBeijingInstant('2026-99-01T10:00'),/北京时间/)});
 await check('tomorrow matches Beijing calendar',()=>{const d=new Date(dayText()+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()+1);assert.equal(nextDay(),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d))});
 session.set(account);
 await check('server pagination parameters and keyword encoding',async()=>{handler=async(url,init)=>{const u=new URL('http://local'+url);assert.equal(u.pathname,'/api/events/search');assert.equal(u.searchParams.get('origin'),'REAL');assert.equal(u.searchParams.get('page'),'7');assert.equal(u.searchParams.get('q'),'A&B ?%');assert.equal(init.headers.get('Authorization'),'Bearer '+account.token);return new Response('{"items":[],"total":225}')};assert.equal((await api.searchEvents('REAL',{page:7,q:'A&B ?%'})).total,225)});
 await check('batch review body preserves domain',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/events/review-batch');assert.equal(init.method,'POST');assert.equal(init.headers.get('Content-Type'),'application/json');const body=JSON.parse(init.body);assert.equal(body.origin,'SIMULATION');assert.equal(body.ids.length,2);assert.equal(body.reviewStatus,'CONFIRMED');return new Response('{"changed":2}')};assert.equal((await api.batchReview('SIMULATION',[1,2],'CONFIRMED','reason')).changed,2)});
 await check('upload includes capture time and actual stall ID without forcing multipart boundary',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/tasks/upload');assert.equal(init.body.get('stallId'),'27');assert.equal(init.body.get('recordedAt'),'2026-10-15T11:30:00Z');assert.ok(init.body.get('file') instanceof File);assert.equal(init.headers.has('Content-Type'),false);return new Response('{}')};await api.upload(new File(['x'],'x.mp4'),'SIMULATION','demo-color',27,'2026-10-15T11:30:00Z')});
 await check('task cancel is POST',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/tasks/abc/cancel');assert.equal(init.method,'POST');return new Response('{}')};await api.cancelTask('abc')});
 await check('failed task retry is POST',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/tasks/abc/retry');assert.equal(init.method,'POST');return new Response('{}')};await api.retryTask('abc')});
 await check('forecast apply requires explicit overwrite flag',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/planning/apply-forecast/abc?overwrite=true');assert.equal(init.method,'POST');return new Response('{}')};await api.applyForecast('abc',true)});
 await check('forecast history includes domain and meal',async()=>{handler=async(url)=>{assert.equal(url,'/api/forecasts?origin=REAL&mealSlot=LUNCH');return new Response('[]')};assert.equal((await api.forecastHistory('REAL','LUNCH')).length,0)});
 await check('204 response does not parse JSON',async()=>{handler=async()=>new Response(null,{status:204});assert.equal(await request('/auth/logout',{method:'POST'}),undefined)});
 await check('HTTP error retains backend message',async()=>{handler=async()=>new Response('{"message":"validation rejected"}',{status:400});await assert.rejects(()=>request('/test'),/validation rejected/)});
 await check('403 does not clear a valid login',async()=>{handler=async()=>new Response('{"message":"permission"}',{status:403});await assert.rejects(()=>request('/test'),/permission/);assert.equal(session.get().token,account.token)});
 await check('401 clears stale login and notifies shell',async()=>{handler=async()=>new Response('{"message":"expired"}',{status:401});await assert.rejects(()=>request('/test'),/expired/);assert.equal(session.get(),null);assert.ok(notices.includes('zaoyan:unauthorized'))});
 await check('pre-aborted request is passed to fetch',async()=>{const controller=new AbortController();controller.abort();handler=async(url,init)=>{assert.equal(init.signal.aborted,true);throw new Error('aborted')};await assert.rejects(()=>request('/test',{signal:controller.signal}),/aborted/)});
 await check('evidence blob uses authenticated request',async()=>{session.set(account);handler=async(url,init)=>{assert.equal(url,'/api/tasks/abc/video?source=true');assert.equal(init.headers.Authorization,'Bearer '+account.token);return new Response('video-data')};assert.equal(await (await authorizedBlob('/tasks/abc/video?source=true')).text(),'video-data')});

 await check('task history encodes all filters and an explicit first page',async()=>{handler=async(url)=>{const p=new URL('http://local'+url);assert.equal(p.pathname,'/api/tasks/search');assert.equal(p.searchParams.get('origin'),'REAL');assert.equal(p.searchParams.get('q'),'中文 & #');assert.equal(p.searchParams.get('page'),'0');assert.equal(p.searchParams.get('size'),'10');return new Response('{"items":[],"pages":0,"total":0}')};await api.taskSearch('REAL',{q:'中文 & #',page:0,size:10})});
 await check('reanalysis creates a version rather than retrying old events',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/tasks/id/reanalyze');assert.equal(init.method,'POST');return new Response('{}')};await api.reanalyze('id')});
 await check('analysis activation retains operator reason',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/tasks/id/activate');assert.equal(JSON.parse(init.body).note,'new calibration');return new Response('{}')};await api.activateTask('id','new calibration')});
 await check('review transmits structured exception reason',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/events/8/review');const b=JSON.parse(init.body);assert.equal(b.reason,'EMPTY_CONTAINER');assert.equal(b.reviewStatus,'REJECTED');return new Response('{}')};await api.review(8,'REJECTED','empty tray','EMPTY_CONTAINER')});
 await check('position correction preserves idempotence key and offset',async()=>{handler=async(url,init)=>{const b=JSON.parse(init.body);assert.equal(url,'/api/events/manual');assert.equal(b.requestKey,'fixed-request-id');assert.equal(b.taskId,'t');assert.equal(b.offsetSeconds,12.5);return new Response('{}')};await api.manual({stallId:1,origin:'SIMULATION',taskId:'t',offsetSeconds:12.5,occurredAt:'2026-01-01T00:00:00Z',note:'visible serving',requestKey:'fixed-request-id'})});
 await check('full review audit history is paginated and scoped',async()=>{handler=async(url)=>{const p=new URL('http://local'+url);assert.equal(p.pathname,'/api/audits/search');assert.equal(p.searchParams.get('eventId'),'8');assert.equal(p.searchParams.get('page'),'6');assert.equal(p.searchParams.get('origin'),'REAL');return new Response('{}')};await api.auditSearch('REAL',{eventId:8,page:6})});
 await check('business audit is scoped and paginated',async()=>{handler=async(url)=>{assert.equal(url,'/api/business-audits?origin=SIMULATION&page=2');return new Response('{}')};await api.businessAudits('SIMULATION',2)});
 await check('forecast history uses unbounded backend pagination',async()=>{handler=async(url)=>{assert.equal(url,'/api/forecasts/search?origin=REAL&mealSlot=DINNER&page=9');return new Response('{}')};await api.forecastSearch('REAL','DINNER',9)});
 await check('settlement draft preserves explicit units',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/settlements');const b=JSON.parse(init.body);assert.equal(b.portionsPerEvent,2);assert.equal(b.serviceDate,'2026-01-01');return new Response('{}')};await api.settlement({stallId:1,origin:'REAL',serviceDate:'2026-01-01',mealSlot:'LUNCH',portionsPerEvent:2})});
 await check('draft reload survives page refresh',async()=>{handler=async(url)=>{assert.equal(url,'/api/settlements/draft-id');return new Response('{}')};await api.getSettlement('draft-id')});
 await check('settlement confirmation never silently forces zero or overwrite',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/settlements/d/confirm');const b=JSON.parse(init.body);assert.equal(b.coverageConfirmed,true);assert.equal(b.unitsConfirmed,true);assert.equal(b.zeroConfirmed,false);assert.equal(b.overwrite,false);return new Response('{}')};await api.confirmSettlement('d',{coverageConfirmed:true,unitsConfirmed:true,zeroConfirmed:false,overwrite:false,note:'checked'})});
 await check('prep revision and manual override go to backend',async()=>{handler=async(url,init)=>{const b=JSON.parse(init.body);assert.equal(b.expectedRevision,7);assert.equal(b.manualOverride,true);assert.equal(b.actualQty,0);return new Response('{}')};await api.savePrep({stallId:1,origin:'REAL',serviceDate:'2026-01-01',mealSlot:'LUNCH',plannedQty:3,preparedQty:3,actualQty:0,note:'verified zero',expectedRevision:7,manualOverride:true})});
 await check('calibration saves complete shared rules not just page state',async()=>{handler=async(url,init)=>{assert.equal(url,'/api/stalls/1');const b=JSON.parse(init.body);assert.equal(b.rules.roiX1,.2);assert.equal(b.rules.nestingPolicy,'INNER');return new Response('{}')};await api.saveStall(1,{name:'stall',location:'lab',lineX1:.25,lineY1:.5,lineX2:.75,lineY2:.5,direction:'positive',rules:{...context.exports.defaultRules,roiX1:.2,nestingPolicy:'INNER'}})});
 await check('risk display retains unknown future risk codes',()=>{assert.equal(context.exports.riskText('LOW_CONFIDENCE,NEW_CODE'),'低置信度；NEW_CODE')});
 console.log(JSON.stringify({status:'PASSED',tests:count,scope:'frontend API unit tests; mocked network'}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
