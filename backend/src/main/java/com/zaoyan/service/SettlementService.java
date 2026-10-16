package com.zaoyan.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;
import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import java.time.*;import java.util.*;

/** Explicitly confirmed reconciliation, not an automatic claim about sales or meal portions. */
@Service public class SettlementService {
    private static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
    private final StallRepository stalls;private final CountEventRepository events;private final VideoTaskRepository tasks;
    private final PrepRepository prep;private final SettlementDraftRepository drafts;private final EventScope scope;
    private final BusinessLog log;private final ObjectMapper mapper;
    public SettlementService(StallRepository stalls,CountEventRepository events,VideoTaskRepository tasks,
        PrepRepository prep,SettlementDraftRepository drafts,EventScope scope,BusinessLog log,ObjectMapper mapper){
        this.stalls=stalls;this.events=events;this.tasks=tasks;this.prep=prep;this.drafts=drafts;this.scope=scope;this.log=log;this.mapper=mapper;
    }
    private record Source(Instant start,Instant end,int confirmed,int pending,int rejected,int excluded,
        String digest,List<Map<String,Object>> coverage,boolean running){}
    private Source source(Stall stall,Origin origin,LocalDate day,String slot,int ratio){
        var m=stall.getRules().meal(slot);
        Instant start=day.atTime(LocalTime.parse(m.start())).atZone(ZONE).toInstant();
        Instant end=day.atTime(LocalTime.parse(m.end())).atZone(ZONE).toInstant();
        List<CountEvent> rows=events.findByOriginAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(origin,start,end)
            .stream().filter(e->stall.id.equals(e.stallId)).sorted(Comparator.comparing(e->e.id)).toList();
        scope.decorate(rows);int confirmed=0,pending=0,rejected=0,excluded=0;
        StringBuilder digest=new StringBuilder(stall.id+":"+origin+":"+start+":"+end+":"+ratio);
        for(CountEvent e:rows){
            digest.append('|').append(e.id).append(':').append(e.reviewStatus).append(':').append(e.statsIncluded).append(':').append(e.updatedAt).append(':').append(e.occurredAt);
            if(!e.statsIncluded){excluded++;continue;}
            switch(e.reviewStatus){case CONFIRMED->confirmed++;case PENDING->pending++;case REJECTED->rejected++;}
        }
        List<Map<String,Object>> coverage=new ArrayList<>();boolean running=false;
        var recordings=tasks.findByStallIdAndOrigin(stall.id,origin).stream().sorted(Comparator.comparing(t->t.id)).toList();
        for(VideoTask t:recordings){
            Instant from=t.recordedAt==null?t.createdAt:t.recordedAt;
            boolean active=Set.of("QUEUED","RUNNING").contains(t.status);
            Instant until=t.durationSeconds!=null&&t.durationSeconds>0?from.plusMillis(Math.round(t.durationSeconds*1000)):
                ("LIVE".equals(t.mode)&&t.finishedAt!=null?t.finishedAt:from.plusSeconds(86400));
            if(!from.isBefore(end)||!until.isAfter(start))continue;
            boolean effective=scope.effective(t);
            // Running re-analyses need not block settlement: only the active version is relevant.
            boolean blocks=active&&(t.assetId==null||"LIVE".equals(t.mode)||tasks.findByAssetIdOrderByCreatedAtDesc(t.assetId).stream().noneMatch(scope::effective));
            running|=blocks;
            digest.append("|T:").append(t.id).append(':').append(t.status).append(':').append(effective).append(':').append(t.durationSeconds);
            Map<String,Object> item=new LinkedHashMap<>();item.put("taskId",t.id);item.put("filename",Objects.toString(t.originalFilename,"录像"));
            item.put("from",from.toString());item.put("until",t.durationSeconds==null?null:until.toString());item.put("durationKnown",t.durationSeconds!=null);
            item.put("status",t.status);item.put("mode",t.mode);item.put("statsIncluded",effective);coverage.add(item);
        }
        return new Source(start,end,confirmed,pending,rejected,excluded,CaptureService.digest(digest.toString()),coverage,running);
    }
    private String json(Object value){try{return mapper.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);}}
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public SettlementDraft create(Long stallId,Origin origin,LocalDate day,String slot,int ratio,String actor){
        if(day==null||day.isAfter(LocalDate.now(ZONE))||ratio<1||ratio>50)throw new IllegalArgumentException("结算日期或每事件份数无效");
        Stall stall=stalls.lockById(stallId).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        Source s=source(stall,origin,day,slot,ratio);
        if(s.running)throw new IllegalArgumentException("该时段仍有分析或监测任务运行，请结束后再生成结算草稿");
        long quantity=(long)s.confirmed*ratio;if(quantity>100000)throw new IllegalArgumentException("核实份数超过单餐次台账上限");
        SettlementDraft d=new SettlementDraft();d.id=UUID.randomUUID().toString();d.stallId=stallId;d.origin=origin;d.serviceDate=day;d.mealSlot=slot;
        d.windowStart=s.start;d.windowEnd=s.end;d.confirmedCount=s.confirmed;d.pendingCount=s.pending;d.rejectedCount=s.rejected;d.excludedCount=s.excluded;
        d.portionsPerEvent=ratio;d.suggestedQty=(int)quantity;d.sourceDigest=s.digest;d.coverageJson=json(s.coverage);
        d.createdBy=actor;d.expiresAt=Instant.now().plusSeconds(86400);
        prep.findByStallIdAndOriginAndServiceDateAndMealSlot(stallId,origin,day,slot).ifPresent(p->{d.previousRecordId=p.id;d.previousRevision=p.revision==null?0:p.revision;});
        return drafts.save(d);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public PrepRecord confirm(String id,boolean coverageConfirmed,boolean unitsConfirmed,boolean zeroConfirmed,
        boolean overwrite,String note,String actor){
        // The shared stall lock serializes event changes and settlement confirmation.
        SettlementDraft initial=drafts.findById(id).orElseThrow(()->new IllegalArgumentException("结算草稿不存在"));
        Stall stall=stalls.lockById(initial.stallId).orElseThrow();SettlementDraft d=initial;
        if(!coverageConfirmed||!unitsConfirmed||note==null||note.isBlank()||note.length()>300)
            throw new IllegalArgumentException("必须确认完整覆盖、计数口径，并填写核实说明");
        PrepRecord old=prep.findByStallIdAndOriginAndServiceDateAndMealSlot(d.stallId,d.origin,d.serviceDate,d.mealSlot).orElse(null);
        if(old!=null&&d.id.equals(old.sourceDraftId))return old;
        if(d.confirmedAt!=null){
            if(old!=null&&d.id.equals(old.sourceDraftId))return old;
            throw new IllegalArgumentException("此草稿已使用，台账后续已修改；请重新生成草稿");
        }
        if(Instant.now().isBefore(d.windowEnd))throw new IllegalArgumentException("餐次尚未结束，当前仅可查看草稿，不能确认完整餐次出餐量");
        if(d.expiresAt.isBefore(Instant.now()))throw new IllegalArgumentException("草稿已过期，请重新生成");
        Source current=source(stall,d.origin,d.serviceDate,d.mealSlot,d.portionsPerEvent);
        if(current.running||!current.digest.equals(d.sourceDigest))throw new IllegalArgumentException("事件、任务版本或餐次设置已变化，请重新生成草稿");
        if(current.pending>0)throw new IllegalArgumentException("仍有待复核事件，不能作为完整核实出餐量");
        if(current.confirmed==0&&!zeroConfirmed)throw new IllegalArgumentException("零事件不等于零出餐，请明确确认该餐次确实没有出餐");
        if(old!=null&&(!Objects.equals(old.id,d.previousRecordId)||!Objects.equals(old.revision==null?0L:old.revision,d.previousRevision)))
            throw new IllegalArgumentException("备餐台账已被其他操作修改，请重新生成草稿");
        if(old==null&&d.previousRecordId!=null)throw new IllegalArgumentException("原台账已变化");
        if(old!=null&&old.actualQty!=null&&!overwrite)throw new IllegalArgumentException("已有核实出餐量，请明确同意覆盖核实量；计划和实际备餐不会改变");
        PrepRecord p=old==null?new PrepRecord():old;p.stallId=d.stallId;p.origin=d.origin;p.serviceDate=d.serviceDate;p.mealSlot=d.mealSlot;
        p.actualQty=d.suggestedQty;p.sourceDraftId=d.id;p.sourceDigest=d.sourceDigest;p.sourceEventCount=d.confirmedCount;p.portionsPerEvent=d.portionsPerEvent;
        p.verificationSource="REVIEW_SETTLEMENT";p.verificationStale=false;p.verifiedAt=Instant.now();p.verifiedBy=actor;
        p.revision=(p.revision==null?0:p.revision)+1;p.note=note.trim();p=prep.save(p);
        d.confirmedAt=Instant.now();d.confirmedRecordId=p.id;d.confirmedBy=actor;d.confirmationNote=note.trim();drafts.save(d);
        log.add(p.stallId,p.origin,"CONFIRM_SETTLEMENT",d.id,actor,d.confirmedCount+" 次有效容器事件 × "+d.portionsPerEvent+" 份/次 = "+d.suggestedQty+" 份；覆盖已确认；"+note);
        return p;
    }
}
