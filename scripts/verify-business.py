"""Run actual HTTP -> Java -> Python -> temporary H2 checks, never the user's MySQL.
Example inside the built image:
  python verify-business.py --jar /app/server.jar --ai-root /app/ai-engine
The app is launched on an isolated loopback port; test storage is deleted on exit.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--jar',required=True)
    parser.add_argument('--ai-root',required=True)
    parser.add_argument('--isolated',action='store_true',help='Compatibility flag; isolation is always enforced.')
    args=parser.parse_args()
    jar=Path(args.jar).resolve();ai=Path(args.ai_root).resolve()
    if not jar.is_file() or not (ai/'zaoyan_ai').is_dir():
        raise RuntimeError('Built JAR or Python source is missing')
    sys.path.insert(0,str(ai))
    from scripts.generate_sample import generate
    import cv2
    import numpy as np
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    checks=[]
    def checked(name):
        checks.append(name);print('PASS '+name,flush=True)
    with tempfile.TemporaryDirectory(prefix='zaoyan-v12-check-') as directory:
        tmp=Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}/api'
        username='business-check';password=secrets.token_urlsafe(24);operator_password=secrets.token_urlsafe(24)
        env=os.environ.copy()
        env.update(DEMO_USERNAME=username,DEMO_PASSWORD=password,OPERATOR_PASSWORD=operator_password,
                   STORAGE_ROOT=str(tmp/'storage'),AI_ROOT=str(ai),PYTHON_BIN=sys.executable,YOLO_WEIGHTS='',
                   JAVA_TOOL_OPTIONS='-Xms64m -Xmx384m',PYTHONUTF8='1')
        command=['java','-jar',str(jar),'--server.address=127.0.0.1',f'--server.port={port}',
                 '--spring.datasource.url=jdbc:h2:mem:zaoyan_business_smoke;MODE=MySQL;DB_CLOSE_DELAY=-1',
                 '--spring.datasource.username=sa','--spring.datasource.password=',
                 '--spring.jpa.hibernate.ddl-auto=create-drop']
        logfile=tmp/'application.log'
        with logfile.open('wb') as log:
            process=subprocess.Popen(command,cwd=tmp,env=env,stdout=log,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+150
                while time.monotonic()<deadline:
                    if process.poll() is not None:raise RuntimeError('Isolated Spring Boot exited before readiness')
                    try:
                        with opener.open(base+'/health',timeout=2) as response:
                            if json.load(response).get('status')=='ok':break
                    except (OSError,ValueError):time.sleep(.6)
                else:raise TimeoutError('Isolated Spring Boot startup timed out')
                checked('isolated_app_startup')
                token=None
                def request(method,path,data=None,expected=200,as_token=None,raw=False,content_type=None):
                    body=data if isinstance(data,bytes) else (json.dumps(data).encode() if data is not None else None)
                    headers={}
                    credential=token if as_token is None else as_token
                    if credential:headers['Authorization']='Bearer '+credential
                    if body is not None:headers['Content-Type']=content_type or 'application/json'
                    req=urllib.request.Request(base+path,data=body,headers=headers,method=method)
                    try:
                        with opener.open(req,timeout=40) as response:status=response.status;payload=response.read()
                    except urllib.error.HTTPError as error:status=error.code;payload=error.read()
                    if status!=expected:raise AssertionError(f'{method} {path}: HTTP {status}, expected {expected}; {payload[:250]!r}')
                    if raw or not payload:return payload
                    try:return json.loads(payload)
                    except ValueError:return payload.decode('utf-8','replace')
                request('GET','/events/search',expected=401,as_token='')
                token=request('POST','/auth/login',{'username':username,'password':password})['token']
                operator=request('POST','/auth/login',{'username':'operator','password':operator_password},as_token='')['token']
                stall=request('GET','/stalls')[0];sid=stall['id']
                checked('authentication_and_real_stall_lookup')
                caps=request('GET','/system/capabilities')
                assert caps['demoReady'] and not caps['yoloConfigured'],caps
                checked('actual_python_opencv_ffmpeg_probe')
                def multipart(path,name,filename,blob,fields=None,expected=200,as_token=None):
                    boundary='zaoyan-'+secrets.token_hex(12);chunks=[]
                    for k,v in (fields or {}).items():chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
                    chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+blob+b'\r\n')
                    chunks.append(f'--{boundary}--\r\n'.encode())
                    return request('POST',path,b''.join(chunks),expected,as_token,content_type='multipart/form-data; boundary='+boundary)
                def wait(path,allowed=('COMPLETED','FAILED','CANCELLED','INSUFFICIENT'),seconds=100):
                    until=time.monotonic()+seconds
                    while time.monotonic()<until:
                        item=request('GET',path)
                        if item['status'] in allowed:return item
                        time.sleep(.3)
                    raise TimeoutError('Task timed out: '+path)
                cn=timezone(timedelta(hours=8));today=datetime.now(cn).date();capture=datetime.combine(today-timedelta(days=2),datetime.min.time(),cn)+timedelta(hours=11)
                sample=generate(tmp/'synthetic.mp4').read_bytes()
                fields={'stallId':sid,'origin':'SIMULATION','detector':'demo-color','recordedAt':capture.isoformat()}
                task=multipart('/tasks/upload','file','sample.mp4',sample,fields)
                done=wait('/tasks/'+task['id']);assert done['status']=='COMPLETED' and done['rawCount']==3,done
                rows=request('GET','/tasks/'+done['id']+'/events');assert len(rows)==3,rows
                for e in rows:
                    parsed=datetime.fromisoformat(e['occurredAt'].replace('Z','+00:00'))
                    assert abs((parsed-capture).total_seconds()-e['offsetSeconds'])<.01
                video=request('GET','/tasks/'+done['id']+'/video',raw=True);assert len(video)>1000
                checked('upload_python_analysis_three_events_capture_timestamp_and_playable_result')
                scoped=request('GET','/events/search?origin=SIMULATION&taskId='+done['id']);assert scoped['total']==3
                assert request('GET','/events/search?origin=REAL')['total']==0
                request('POST','/events/review-batch',{'origin':'SIMULATION','ids':[rows[0]['id'],rows[1]['id']],'reviewStatus':'CONFIRMED','note':'isolated verification'})
                request('PATCH','/events/'+str(rows[2]['id'])+'/review',{'reviewStatus':'REJECTED','note':'isolated verification'})
                report=request('GET',f'/reports/daily?origin=SIMULATION&date={capture.date()}')
                assert report['count']==2 and report['confirmed']==2 and report['rejected']==1 and len(report['hourly'])==24,report
                assert not request('GET','/audits?origin=REAL')
                assert len(request('GET','/audits?origin=SIMULATION&eventId='+str(rows[2]['id'])))==1
                request('POST','/events/review-batch',{'origin':'REAL','ids':[rows[0]['id']],'reviewStatus':'REJECTED','note':'must rollback'},expected=400)
                assert request('GET','/tasks/'+done['id']+'/events')[0]['reviewStatus']=='CONFIRMED'
                checked('pagination_task_filter_transactional_review_audit_and_origin_isolation')
                request('POST','/events/manual',{'stallId':sid,'origin':'SIMULATION','occurredAt':capture.isoformat(),'taskId':done['id'],'offsetSeconds':1.5,'note':'manual verification'})
                assert len(request('GET','/tasks/'+done['id']+'/events'))==4
                summary=request('GET',f'/reports/summary.csv?origin=SIMULATION&date={capture.date()}',raw=True)
                assert summary.startswith(b'\xef\xbb\xbf')
                checked('linked_manual_correction_and_utf8_summary_export')
                repeated=multipart('/tasks/upload','file','same-content-other-name.mp4',sample,fields)
                assert repeated['id']==done['id'] and repeated['reusedUpload'] and repeated['statsIncluded'],repeated
                task_page=request('GET','/tasks/search?origin=SIMULATION&page=0&size=1')
                assert task_page['size']==1 and task_page['total']>=1 and len(task_page['items'])==1
                manual_key=secrets.token_hex(16)
                manual_payload={'stallId':sid,'origin':'SIMULATION','occurredAt':capture.isoformat(),'taskId':done['id'],
                                'offsetSeconds':2.,'note':'idempotent playhead correction','requestKey':manual_key}
                once=request('POST','/events/manual',manual_payload)
                assert request('POST','/events/manual',manual_payload)['id']==once['id']
                request('POST','/events/manual',{**manual_payload,'requestKey':secrets.token_hex(16),'offsetSeconds':done['durationSeconds']+10},expected=400)
                audit_page=request('GET','/audits/search?origin=SIMULATION&eventId='+str(once['id']))
                assert audit_page['total']==1,audit_page
                assert request('GET','/audits/search?origin=REAL')['total']==0
                checked('content_hash_duplicate_reuse_paged_histories_and_playhead_idempotence')
                rules=stall['rules'];new_rules={**rules,'stableFrames':3}
                saved=request('PUT','/stalls/'+str(sid),{'name':stall['name'],'location':stall['location'],
                      'lineX1':stall['lineX1'],'lineY1':stall['lineY1'],'lineX2':stall['lineX2'],'lineY2':stall['lineY2'],
                      'direction':stall['direction'],'rules':new_rules})
                assert saved['rules']['stableFrames']==3
                assert request('GET','/tasks/'+done['id'])['rules']['stableFrames']==2
                changed=request('POST','/tasks/'+done['id']+'/reanalyze');changed=wait('/tasks/'+changed['id'])
                assert changed['status']=='COMPLETED' and changed['rules']['stableFrames']==3 and not changed['statsIncluded'],changed
                # Never mix both versions in the same daily count.
                before=request('GET',f'/reports/daily?origin=SIMULATION&date={capture.date()}')['count']
                assert before==4,before # two confirmed auto + two independent manual entries
                request('POST','/tasks/'+changed['id']+'/activate',{'note':'isolated new calibration verification'})
                assert request('GET',f'/reports/daily?origin=SIMULATION&date={capture.date()}')['count']==3
                assert not request('GET','/tasks/'+done['id'])['statsIncluded']
                changed_rows=request('GET','/tasks/'+changed['id']+'/events')
                settlement_input={'stallId':sid,'origin':'SIMULATION','serviceDate':str(capture.date()),'mealSlot':'LUNCH','portionsPerEvent':1}
                pending=request('POST','/settlements',settlement_input);assert pending['pendingCount']==3
                confirm_body={'coverageConfirmed':True,'unitsConfirmed':True,'zeroConfirmed':False,'overwrite':False,'note':'synthetic complete shift confirmed only for test'}
                request('POST','/settlements/'+pending['id']+'/confirm',confirm_body,expected=400)
                request('POST','/events/review-batch',{'origin':'SIMULATION','ids':[x['id'] for x in changed_rows],
                        'reviewStatus':'CONFIRMED','note':'synthetic verification'})
                request('POST','/settlements/'+pending['id']+'/confirm',confirm_body,expected=400) # stale digest
                clean=request('POST','/settlements',settlement_input)
                request('POST','/settlements/'+clean['id']+'/confirm',{**confirm_body,'coverageConfirmed':False},expected=400)
                settled=request('POST','/settlements/'+clean['id']+'/confirm',confirm_body)
                assert settled['actualQty']==3 and settled['verificationSource']=='REVIEW_SETTLEMENT'
                again=request('POST','/settlements/'+clean['id']+'/confirm',confirm_body)
                assert again['id']==settled['id'] and again['revision']==settled['revision']
                new_draft=request('POST','/settlements',settlement_input)
                request('POST','/settlements/'+new_draft['id']+'/confirm',confirm_body,expected=400) # existing actual needs consent
                request('PATCH','/events/'+str(changed_rows[0]['id'])+'/review',{'reviewStatus':'REJECTED','note':'empty container in controlled test','reason':'EMPTY_CONTAINER'})
                stale=next(p for p in request('GET','/prep?origin=SIMULATION') if p['id']==settled['id'])
                assert stale['verificationStale'] and stale['actualQty']==3
                fixed=request('POST','/settlements',settlement_input)
                settled=request('POST','/settlements/'+fixed['id']+'/confirm',{**confirm_body,'overwrite':True})
                assert not settled['verificationStale'] and settled['actualQty']==2
                zero=request('POST','/settlements',{**settlement_input,'mealSlot':'BREAKFAST'})
                request('POST','/settlements/'+zero['id']+'/confirm',confirm_body,expected=400)
                assert request('POST','/settlements/'+zero['id']+'/confirm',{**confirm_body,'zeroConfirmed':True})['actualQty']==0
                assert request('GET','/business-audits?origin=SIMULATION')['total']>=4
                checked('calibration_snapshot_active_version_settlement_consent_zero_guard_stale_source_and_safe_reconfirmation')

                multipart('/tasks/upload','file','sample.mp4',sample,{**fields,'origin':'REAL'},expected=400)
                bad=multipart('/tasks/upload','file','invalid.mp4',b'not-a-video',fields)
                assert wait('/tasks/'+bad['id'])['status']=='FAILED'
                request('POST','/tasks/'+bad['id']+'/retry')
                assert wait('/tasks/'+bad['id'])['attempt']==2
                assert not request('GET','/tasks/'+bad['id']+'/events')
                cancel=request('POST','/tasks/'+done['id']+'/reanalyze')
                request('POST','/tasks/'+cancel['id']+'/cancel')
                cancelled=wait('/tasks/'+cancel['id'])
                assert cancelled['status'] in ('CANCELLED','COMPLETED'),cancelled
                if cancelled['status']=='CANCELLED':assert not request('GET','/tasks/'+cancel['id']+'/events')
                else:assert not cancelled['statsIncluded'] # completion can legitimately win the race
                checked('failed_retry_cancel_and_real_domain_demo_rejection')
                f=request('POST','/forecasts',{'stallId':sid,'origin':'SIMULATION','mealSlot':'DINNER','targetDate':str(today+timedelta(days=1)),'bufferRate':.08})
                assert wait('/forecasts/'+f['id'])['status']=='INSUFFICIENT'
                seed=request('POST',f'/planning/seed-simulation?stallId={sid}&mealSlot=LUNCH');assert seed['created']+seed['skipped']==8 and seed['skipped']>=1
                assert request('POST',f'/planning/seed-simulation?stallId={sid}&mealSlot=LUNCH')['created']==0
                tomorrow=str(today+timedelta(days=1))
                f=request('POST','/forecasts',{'stallId':sid,'origin':'SIMULATION','mealSlot':'LUNCH','targetDate':tomorrow,'bufferRate':.08})
                f=wait('/forecasts/'+f['id']);assert f['status']=='COMPLETED' and f['sampleSize']>=3,f
                assert any(x['id']==f['id'] for x in request('GET','/forecasts/search?origin=SIMULATION&mealSlot=LUNCH')['items'])
                request('POST','/prep',{'stallId':sid,'origin':'SIMULATION','serviceDate':tomorrow,'mealSlot':'LUNCH','plannedQty':20,'preparedQty':9,'actualQty':None,'note':'keep actual fields'})
                request('POST','/planning/apply-forecast/'+f['id'],expected=400)
                applied=request('POST','/planning/apply-forecast/'+f['id']+'?overwrite=true')
                assert applied['plannedQty']==f['recommendedQty'] and applied['preparedQty']==9 and applied['actualQty'] is None
                request('POST','/prep',{'stallId':sid,'origin':'SIMULATION','serviceDate':tomorrow,'mealSlot':'LUNCH','plannedQty':1,'preparedQty':1,'actualQty':1},expected=400)
                checked('forecast_cutoff_history_insufficient_samples_seed_idempotence_and_safe_plan_application')
                live=request('POST','/live/start',{'stallId':sid,'origin':'SIMULATION','detector':'demo-color'})['sessionId']
                img=np.zeros((520,900,3),dtype=np.uint8)
                for y in range(120,421,20):
                    frame=img.copy();cv2.rectangle(frame,(360,y-30),(440,y+30),(160,170,42),-1)
                    ok,jpg=cv2.imencode('.jpg',frame);assert ok
                    result=multipart('/live/'+live+'/frame','frame','frame.jpg',jpg.tobytes())
                assert result['sessionCount']==1,result
                multipart('/live/'+live+'/frame','frame','frame.jpg',jpg.tobytes(),expected=403,as_token=operator)
                request('POST','/live/'+live+'/stop')
                request('POST','/live/'+live+'/stop')
                live_task=request('GET','/tasks/'+live)
                assert live_task['mode']=='LIVE' and live_task['status']=='COMPLETED' and not live_task['hasSourceVideo']
                assert len(request('GET','/tasks/'+live+'/events'))==1
                checked('live_jpeg_crossing_owner_authorization_persistence_and_idempotent_stop')
                request('POST','/auth/logout',expected=204)
                request('GET','/stalls',expected=401)
                checked('logout_revokes_server_token')
                print(json.dumps({'status':'PASSED','isolation':'temporary H2 + temporary storage, no production DB writes','checks':checks},ensure_ascii=True),flush=True)
            except Exception:
                log.flush()
                tail='\n'.join(logfile.read_text(errors='replace').splitlines()[-60:])
                print(tail.replace(password,'[REDACTED]').replace(operator_password,'[REDACTED]'),file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=15)
                    except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)


if __name__=='__main__':
    main()
