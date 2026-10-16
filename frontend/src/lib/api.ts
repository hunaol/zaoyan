export type Origin = 'SIMULATION' | 'REAL'
export type ReviewStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'
export type Detector = 'demo-color' | 'yolo'
export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER'
export type User = {token:string;username:string;role:'ADMIN'|'OPERATOR';expiresAt:string}
export type CountingRules = {schemaVersion:number;roiX1:number;roiY1:number;roiX2:number;roiY2:number;
 confidence:number;reviewConfidence:number;deadzone:number;stableFrames:number;maxGapSeconds:number;
 duplicateWindowSeconds:number;duplicateDistance:number;nestingPolicy:'OUTER'|'INNER';targetLabels:string[];emptyLabels:string[];
 meals:{slot:MealSlot;start:string;end:string}[]}
export const defaultRules:CountingRules={schemaVersion:1,roiX1:0,roiY1:0,roiX2:1,roiY2:1,confidence:.35,reviewConfidence:.65,
 deadzone:.012,stableFrames:2,maxGapSeconds:2.5,duplicateWindowSeconds:1.5,duplicateDistance:.08,nestingPolicy:'OUTER',
 targetLabels:['tray','plate','lunchbox','mealbox','meal box','food box','bowl'],emptyLabels:['empty_tray','empty_box'],
 meals:[{slot:'BREAKFAST',start:'06:00',end:'10:00'},{slot:'LUNCH',start:'10:00',end:'16:00'},{slot:'DINNER',start:'16:00',end:'22:00'}]}
export type Page<T>={items:T[];total:number;pages:number;page:number;size:number}
export type Audit={fromReason?:string|null;toReason?:string|null;id:number;eventId:number;operatorName:string;fromStatus:string;toStatus:string;note:string;operatedAt:string}
export type BusinessAudit={id:number;action:string;resourceId:string;operatorName:string;detail:string;operatedAt:string}
export type Coverage={taskId:string;filename:string;from:string;until:string|null;durationKnown:boolean;status:string;mode:string;statsIncluded:boolean}
export type Settlement={id:string;stallId:number;origin:Origin;serviceDate:string;mealSlot:MealSlot;windowStart:string;windowEnd:string;
 confirmedCount:number;pendingCount:number;rejectedCount:number;excludedCount:number;portionsPerEvent:number;suggestedQty:number;
 coverageJson:string;sourceDigest:string;previousRecordId:number|null;previousRevision:number|null;confirmedAt:string|null;expiresAt:string;confirmationNote:string|null}
export const reasonName:Record<string,string>={CONTENT_UNVERIFIED:'内容物尚未人工核实',LOW_CONFIDENCE:'低置信度',NESTED_TARGET:'托盘与餐盒嵌套',
 OVERLAP:'遮挡或重叠',POSSIBLE_DUPLICATE:'短时相近越线，疑似重复',TRACK_GAP:'轨迹曾中断',RETURN_MOVEMENT:'曾反向经过'}
export const reviewReasons:Record<string,string>={NORMAL:'核实有效',EMPTY_CONTAINER:'空容器 / 无交付',DUPLICATE:'同一次交付重复记录',
 NESTED_TARGET:'托盘与餐盒重复计入',OCCLUSION:'遮挡或识别错误',WRONG_DIRECTION:'非出餐方向',OTHER:'其他（说明原因）'}
export const riskText=(value:string|null|undefined)=>(value||'').split(',').filter(Boolean).map(v=>reasonName[v]||v).join('；')
export type Stall = {rules:CountingRules;id:number;name:string;location:string;lineX1:number;lineY1:number;lineX2:number;lineY2:number;direction:'positive'|'negative';createdAt:string}
export type CountEvent = {statsIncluded:boolean;targetLabel:string|null;riskReasons:string|null;reviewReason:string|null;id:number;taskId:string|null;stallId:number;origin:Origin;source:'AUTO'|'MANUAL';reviewStatus:ReviewStatus;trackId:number|null;offsetSeconds:number|null;confidence:number|null;note:string|null;occurredAt:string;createdAt:string}
export type VideoTask = {assetId:string|null;activeTaskId:string|null;statsIncluded:boolean;durationSeconds:number|null;rules:CountingRules;reusedUpload:boolean;id:string;stallId:number;origin:Origin;mode:string;detector:Detector;status:'QUEUED'|'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED';originalFilename:string;progress:number;rawCount:number;frameCount:number;errorMessage:string|null;createdAt:string;finishedAt:string|null;hasResultVideo:boolean;hasSourceVideo:boolean;recordedAt:string;lineX1:number|null;lineY1:number|null;lineX2:number|null;lineY2:number|null;direction:string|null;attempt:number|null}
export type Prep = {revision:number|null;verificationSource:string|null;sourceDraftId:string|null;sourceEventCount:number|null;portionsPerEvent:number|null;verificationStale:boolean;verifiedAt:string|null;verifiedBy:string|null;id:number;stallId:number;origin:Origin;serviceDate:string;mealSlot:MealSlot;plannedQty:number;preparedQty:number;actualQty:number|null;note:string|null}
export type Forecast = {sourceSnapshot:string|null;id:string;stallId:number;origin:Origin;mealSlot:MealSlot;status:'QUEUED'|'RUNNING'|'INSUFFICIENT'|'COMPLETED'|'FAILED';sampleSize:number|null;predictedQty:number|null;recommendedQty:number|null;bufferRate:number;explanation:string|null;errorMessage:string|null;createdAt:string;targetDate:string|null;historyStart:string|null;historyEnd:string|null;lowerQty:number|null;upperQty:number|null;method:string|null}
export type Dashboard = {origin:Origin;date:string;todayCount:number;pendingCount:number;confirmedCount:number;autoEvents:number;preparedCount:number;trend:{date:string;label:string;count:number}[];hourly:{hour:string;count:number}[];recentEvents:CountEvent[]}
export type DailyReport = {staleMeals:number;date:string;origin:Origin;count:number;confirmed:number;rejected:number;pending:number;preparations:Prep[];events:CountEvent[];hourly:{hour:string;count:number}[];preparedQty:number;verifiedQty:number;unverifiedMeals:number;balanceQty:number}
export type LiveFrame = {boxes:{trackId:number;label:string;confidence:number;x:number;y:number;width:number;height:number}[];events:{track_id:number;confidence:number}[];sessionCount:number;detector:Detector}

export const session = {
  get():User|null {try {const raw=localStorage.getItem('zaoyan-session');if(!raw)return null;const user=JSON.parse(raw) as User;
    if(user.expiresAt && new Date(user.expiresAt).getTime()<Date.now()){this.clear();return null}return user;}catch{return null}},
  set(user:User){localStorage.setItem('zaoyan-session',JSON.stringify(user))},
  clear(){localStorage.removeItem('zaoyan-session')}
}

async function responseError(resp:Response):Promise<never> {
  let message=`请求失败：HTTP ${resp.status}`
  try {const data=await resp.json();if(data.message)message=String(data.message)}catch{}
  if(resp.status===401||resp.status===403){if(resp.status===401){session.clear();window.dispatchEvent(new Event('zaoyan:unauthorized'))}}
  throw new Error(message)
}

export async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const user=session.get();const headers=new Headers(init.headers||{})
  if(user)headers.set('Authorization',`Bearer ${user.token}`)
  if(init.body && !(init.body instanceof FormData) && !headers.has('Content-Type'))headers.set('Content-Type','application/json')
  const controller=new AbortController();let timedOut=false
  const timeout=setTimeout(()=>{timedOut=true;controller.abort()},path==='/tasks/upload'?120000:30000)
  const abort=()=>controller.abort();init.signal?.addEventListener('abort',abort,{once:true})
  if(init.signal?.aborted)controller.abort()
  try{
    const resp=await fetch('/api'+path,{...init,headers,signal:controller.signal})
    if(!resp.ok)return await responseError(resp)
    if(resp.status===204)return undefined as T
    return await resp.json() as T
  }catch(e){if(timedOut)throw new Error('请求超时，请刷新确认后台任务状态，不要重复提交');throw e}
  finally{clearTimeout(timeout);init.signal?.removeEventListener('abort',abort)}
}
const query=(params:Record<string,unknown>)=>{const q=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v))});return q.toString()}
export const api={
  login:(username:string,password:string)=>request<User>('/auth/login',{method:'POST',body:JSON.stringify({username,password})}),
  logout:()=>request<void>('/auth/logout',{method:'POST'}),
  dashboard:(origin:Origin)=>request<Dashboard>(`/dashboard?origin=${origin}`),
  stalls:()=>request<Stall[]>('/stalls'),
  saveStall:(id:number,data:Omit<Stall,'id'|'createdAt'>)=>request<Stall>(`/stalls/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  taskSearch:(origin:Origin,params:{mode?:string;status?:string;date?:string;q?:string;page?:number;size?:number}={})=>request<Page<VideoTask>>('/tasks/search?'+query({origin,...params})),
  reanalyze:(id:string)=>request<VideoTask>(`/tasks/${id}/reanalyze`,{method:'POST'}),
  activateTask:(id:string,note:string)=>request<VideoTask>(`/tasks/${id}/activate`,{method:'POST',body:JSON.stringify({note})}),
  auditSearch:(origin:Origin,params:{eventId?:number;date?:string;q?:string;page?:number}={})=>request<Page<Audit>>('/audits/search?'+query({origin,...params})),
  businessAudits:(origin:Origin,page=0)=>request<Page<BusinessAudit>>('/business-audits?'+query({origin,page})),
  forecastSearch:(origin:Origin,mealSlot:MealSlot,page=0)=>request<Page<Forecast>>('/forecasts/search?'+query({origin,mealSlot,page})),
  settlement:(input:{stallId:number;origin:Origin;serviceDate:string;mealSlot:MealSlot;portionsPerEvent:number})=>request<Settlement>('/settlements',{method:'POST',body:JSON.stringify(input)}),
  confirmSettlement:(id:string,input:{coverageConfirmed:boolean;unitsConfirmed:boolean;zeroConfirmed:boolean;overwrite:boolean;note:string})=>request<Prep>(`/settlements/${id}/confirm`,{method:'POST',body:JSON.stringify(input)}),
  getSettlement:(id:string)=>request<Settlement>(`/settlements/${id}`),
  tasks:(origin:Origin='SIMULATION')=>request<VideoTask[]>(`/tasks?origin=${origin}`),
  cancelTask:(id:string)=>request<VideoTask>(`/tasks/${id}/cancel`,{method:'POST'}),
  retryTask:(id:string)=>request<VideoTask>(`/tasks/${id}/retry`,{method:'POST'}),
  task:(id:string)=>request<VideoTask>(`/tasks/${id}`),
  upload:(file:File,origin:Origin,detector:Detector,stallId:number,recordedAt?:string)=>{
    const form=new FormData();form.append('file',file);form.append('origin',origin);form.append('detector',detector);form.append('stallId',String(stallId));if(recordedAt)form.append('recordedAt',recordedAt);
    return request<VideoTask>('/tasks/upload',{method:'POST',body:form})
  },
  searchEvents:(origin:Origin,params:{status?:ReviewStatus;date?:string;taskId?:string;q?:string;page?:number})=>{const query=new URLSearchParams({origin,size:'30'});Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!=='')query.set(k,String(v))});return request<{items:CountEvent[];total:number;pages:number;page:number;size:number}>(`/events/search?${query}`)},
  batchReview:(origin:Origin,ids:number[],reviewStatus:ReviewStatus,note:string)=>request<{changed:number}>('/events/review-batch',{method:'POST',body:JSON.stringify({origin,ids,reviewStatus,note})}),
  events:(origin:Origin)=>request<CountEvent[]>(`/events?origin=${origin}`),
  taskEvents:(id:string)=>request<CountEvent[]>(`/tasks/${id}/events`),
  review:(id:number,reviewStatus:ReviewStatus,note:string,reason?:string)=>request<CountEvent>(`/events/${id}/review`,{method:'PATCH',body:JSON.stringify({reviewStatus,note,reason})}),
  manual:(body:{stallId:number;origin:Origin;occurredAt:string;note:string;taskId?:string;offsetSeconds?:number;requestKey?:string})=>request<CountEvent>('/events/manual',{method:'POST',body:JSON.stringify(body)}),
  audits:(origin:Origin='SIMULATION',eventId?:number)=>request<{id:number;eventId:number;operatorName:string;fromStatus:string;toStatus:string;note:string;operatedAt:string}[]>(`/audits?origin=${origin}${eventId?`&eventId=${eventId}`:''}`),
  prep:(origin:Origin)=>request<Prep[]>(`/prep?origin=${origin}`),
  savePrep:(input:{stallId:number;origin:Origin;serviceDate:string;mealSlot:MealSlot;plannedQty:number;preparedQty:number;actualQty:number|null;note:string;expectedRevision?:number;manualOverride?:boolean})=>request<Prep>('/prep',{method:'POST',body:JSON.stringify(input)}),
  forecast:(input:{stallId:number;origin:Origin;mealSlot:MealSlot;bufferRate:number;targetDate?:string})=>request<Forecast>('/forecasts',{method:'POST',body:JSON.stringify(input)}),
  forecastHistory:(origin:Origin,mealSlot:MealSlot)=>request<Forecast[]>(`/forecasts?origin=${origin}&mealSlot=${mealSlot}`),
  seed:(stallId:number,mealSlot:MealSlot)=>request<{created:number;skipped:number}>(`/planning/seed-simulation?stallId=${stallId}&mealSlot=${mealSlot}`,{method:'POST'}),
  applyForecast:(id:string,overwrite=false)=>request<Prep>(`/planning/apply-forecast/${id}?overwrite=${overwrite}`,{method:'POST'}),
  capabilities:()=>request<{python?:string;opencv?:boolean;ffmpeg?:boolean;ultralytics?:boolean;weightsPresent?:boolean;demoReady:boolean;yoloConfigured:boolean;notice:string}>('/system/capabilities'),
  getForecast:(id:string)=>request<Forecast>(`/forecasts/${id}`),
  daily:(origin:Origin,date:string)=>request<DailyReport>(`/reports/daily?origin=${origin}&date=${date}`),
  liveStart:(body:{stallId:number;origin:Origin;detector:Detector})=>request<{sessionId:string;detector:Detector;origin:Origin;message:string}>('/live/start',{method:'POST',body:JSON.stringify(body)}),
  liveFrame:(id:string,blob:Blob)=>{const form=new FormData();form.append('frame',blob,'frame.jpg');return request<LiveFrame>(`/live/${id}/frame`,{method:'POST',body:form})},
  liveStop:(id:string)=>request<void>(`/live/${id}/stop`,{method:'POST'}),
}
export async function authorizedBlob(path:string):Promise<Blob>{
  const headers:HeadersInit={Authorization:`Bearer ${session.get()?.token||''}`}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000)
  try{const resp=await fetch('/api'+path,{headers,signal:controller.signal});if(!resp.ok)return responseError(resp);return await resp.blob()}finally{clearTimeout(timer)}
}
export async function downloadCsv(origin:Origin,date:string,summary=false){
  const blob=await authorizedBlob(`/reports/${summary?'summary':'export'}.csv?origin=${origin}&date=${date}`)
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`灶眼AI-${summary?'汇总':'事件明细'}-${date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)
}
export const fmt=(num:number|undefined|null)=>new Intl.NumberFormat('zh-CN').format(num??0)
export const timeText=(value:string|undefined|null)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'
export const dayText=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const slotName:Record<MealSlot,string>={BREAKFAST:'早餐',LUNCH:'午餐',DINNER:'晚餐'}

export const toBeijingInstant=(value:string)=>{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))throw new Error('请选择有效的北京时间')
  const date=new Date(value+(value.length===16?':00':'')+'+08:00')
  if(Number.isNaN(date.getTime()))throw new Error('请选择有效的北京时间')
  return date.toISOString()
}
export function beijingInputNow(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date())
  const get=(name:string)=>p.find(x=>x.type===name)?.value||''
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export function nextDay(){const d=new Date(dayText()+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()+1);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
