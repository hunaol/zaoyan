package com.zaoyan.web;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.util.*;

@RestController @RequestMapping("/api")
public class EventController {
    private final CountEventRepository events;private final ReviewAuditRepository audits;private final StallRepository stalls;
    private final VideoTaskRepository tasks;private final com.zaoyan.service.EventScope scope;private final com.zaoyan.service.LedgerFreshness freshness;
    public EventController(CountEventRepository events,ReviewAuditRepository audits,StallRepository stalls,VideoTaskRepository tasks,com.zaoyan.service.EventScope scope,com.zaoyan.service.LedgerFreshness freshness){
        this.events=events;this.audits=audits;this.stalls=stalls;this.tasks=tasks;this.scope=scope;this.freshness=freshness;
    }
    @GetMapping("/events")public List<CountEvent> legacy(@RequestParam(defaultValue="SIMULATION")Origin origin){return scope.decorate(events.findTop200ByOriginOrderByOccurredAtDesc(origin));}
    @GetMapping("/events/search")public Map<String,Object> search(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(required=false)ReviewStatus status,@RequestParam(required=false)LocalDate date,
        @RequestParam(required=false)String taskId,@RequestParam(defaultValue="")String q,
        @RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="30")int size){
        if(page<0||size<1||size>100||q.length()>100)throw new IllegalArgumentException("分页或搜索参数无效");
        Specification<CountEvent> spec=(r,query,c)->{
            var clauses=new ArrayList<jakarta.persistence.criteria.Predicate>();
            clauses.add(c.equal(r.get("origin"),origin));
            if(status!=null)clauses.add(c.equal(r.get("reviewStatus"),status));
            if(taskId!=null&&!taskId.isBlank())clauses.add(c.equal(r.get("taskId"),taskId));
            if(date!=null){var z=ZoneId.of("Asia/Shanghai");clauses.add(c.greaterThanOrEqualTo(r.get("occurredAt"),date.atStartOfDay(z).toInstant()));clauses.add(c.lessThan(r.get("occurredAt"),date.plusDays(1).atStartOfDay(z).toInstant()));}
            if(!q.isBlank()){
                String term="%"+q.trim().toLowerCase(Locale.ROOT).replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%";
                var matches=new ArrayList<jakarta.persistence.criteria.Predicate>();
                matches.add(c.like(c.lower(r.get("note")),term,'\\'));matches.add(c.like(c.lower(r.get("taskId")),term,'\\'));
                try{long n=Long.parseLong(q.trim());matches.add(c.equal(r.get("id"),n));if(n<=Integer.MAX_VALUE&&n>=0)matches.add(c.equal(r.get("trackId"),(int)n));}catch(NumberFormatException ignored){}
                clauses.add(c.or(matches.toArray(new jakarta.persistence.criteria.Predicate[0])));
            }
            return c.and(clauses.toArray(new jakarta.persistence.criteria.Predicate[0]));
        };
        Page<CountEvent> result=events.findAll(spec,PageRequest.of(page,size,Sort.by(Sort.Order.desc("occurredAt"),Sort.Order.desc("id"))));
        scope.decorate(result.getContent());return Map.of("items",result.getContent(),"total",result.getTotalElements(),"page",page,"size",size,"pages",result.getTotalPages());
    }
    public record Review(@NotNull ReviewStatus reviewStatus,@Size(max=300)String note,@Pattern(regexp="NORMAL|EMPTY_CONTAINER|DUPLICATE|NESTED_TARGET|OCCLUSION|WRONG_DIRECTION|OTHER")String reason){}
    public record Batch(@NotNull Origin origin,@NotEmpty @Size(max=100)List<@NotNull Long> ids,@NotNull ReviewStatus reviewStatus,@Size(max=300)String note){}
    private CountEvent change(CountEvent e,ReviewStatus status,String note,String actor,String reason){
        if(e.reviewStatus==status&&Objects.equals(e.note,note)&&Objects.equals(e.reviewReason,reason))return e;
        ReviewAudit a=new ReviewAudit();a.eventId=e.id;a.operatorName=actor;a.fromStatus=e.reviewStatus.name();a.toStatus=status.name();a.note=note;a.fromReason=e.reviewReason;a.toReason=reason;
        e.reviewStatus=status;e.note=note;e.reviewReason=reason;e.updatedAt=Instant.now();events.save(e);freshness.touch(e.stallId,e.origin,e.occurredAt);audits.save(a);return e;
    }
    @PatchMapping("/events/{id}/review") @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public CountEvent review(@PathVariable Long id,@Valid @RequestBody Review dto,Authentication actor){
        stalls.lockById(events.stallOf(id).orElseThrow(()->new IllegalArgumentException("事件不存在"))).orElseThrow();
        CountEvent e=events.lockById(id).orElseThrow();
        if(dto.reviewStatus()==ReviewStatus.REJECTED&&(dto.note()==null||dto.note().isBlank()))throw new IllegalArgumentException("剔除事件须填写原因");
        String reason=dto.reason()!=null?dto.reason():(dto.reviewStatus()==ReviewStatus.CONFIRMED?"NORMAL":dto.reviewStatus()==ReviewStatus.REJECTED?"OTHER":null);
        return change(e,dto.reviewStatus(),dto.note(),actor.getName(),reason);
    }
    @PostMapping("/events/review-batch") @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Map<String,Integer> batch(@Valid @RequestBody Batch dto,Authentication actor){
        // Sorted row locks prevent deadlocks. Any invalid ID rolls back the entire batch + audits.
        if(dto.reviewStatus()==ReviewStatus.REJECTED&&(dto.note()==null||dto.note().isBlank()))throw new IllegalArgumentException("剔除事件须填写原因");
        java.util.SortedSet<Long> stallIds=new java.util.TreeSet<>();
        for(Long id:dto.ids())stallIds.add(events.stallOf(id).orElseThrow(()->new IllegalArgumentException("事件不存在")));
        for(Long stallId:stallIds)stalls.lockById(stallId).orElseThrow();
        List<CountEvent> batch=new ArrayList<>();
        for(Long id:new TreeSet<>(dto.ids())){
            CountEvent e=events.lockById(id).orElseThrow(()->new IllegalArgumentException("批量事件中包含不存在的记录"));
            if(e.origin!=dto.origin())throw new IllegalArgumentException("不能跨数据域批量复核");batch.add(e);
        }
        int changed=0;
        for(CountEvent e:batch)if(e.reviewStatus!=dto.reviewStatus()){change(e,dto.reviewStatus(),dto.note(),actor.getName(),dto.reviewStatus()==ReviewStatus.CONFIRMED?"NORMAL":dto.reviewStatus()==ReviewStatus.REJECTED?"OTHER":null);changed++;}
        return Map.of("changed",changed);
    }
    public record Manual(@NotNull Long stallId,@NotNull Origin origin,@NotNull Instant occurredAt,@Size(max=300)String note,
        @Size(max=36)String taskId,@DecimalMin("0.0")Double offsetSeconds,@Size(max=64)String requestKey){}
    @PostMapping("/events/manual") @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public CountEvent manual(@Valid @RequestBody Manual dto,Authentication actor){
        if(stalls.lockById(dto.stallId()).isEmpty())throw new IllegalArgumentException("档口不存在");
        if(dto.note()==null||dto.note().isBlank())throw new IllegalArgumentException("补录必须填写原因");
        if(dto.offsetSeconds()!=null&&(dto.taskId()==null||dto.taskId().isBlank()))throw new IllegalArgumentException("视频定位补录必须关联任务");
        if(dto.requestKey()!=null){var old=events.findByRequestKey(dto.requestKey());if(old.isPresent()){
            CountEvent previous=old.get();
            if(!Objects.equals(previous.stallId,dto.stallId())||previous.origin!=dto.origin()||!Objects.equals(previous.taskId,dto.taskId())||!Objects.equals(previous.offsetSeconds,dto.offsetSeconds()))
                throw new IllegalArgumentException("补录幂等键已用于另一项操作");return previous;
        }}
        CountEvent e=new CountEvent();e.stallId=dto.stallId();e.origin=dto.origin();e.occurredAt=dto.occurredAt();
        if(dto.taskId()!=null&&!dto.taskId().isBlank()){
            VideoTask t=tasks.findById(dto.taskId()).orElseThrow(()->new IllegalArgumentException("任务不存在"));
            if(t.origin!=dto.origin()||!t.stallId.equals(dto.stallId()))throw new IllegalArgumentException("任务与补录数据域或档口不匹配");
            if(!"COMPLETED".equals(t.status)&&!"LIVE".equals(t.mode))throw new IllegalArgumentException("上传视频须完成分析后再补录");
            if(dto.offsetSeconds()!=null&&(!"UPLOAD".equals(t.mode)||t.durationSeconds==null||dto.offsetSeconds()>t.durationSeconds))
                throw new IllegalArgumentException("视频位置超出录像时长或此任务没有可靠时长");
            e.taskId=t.id;e.offsetSeconds=dto.offsetSeconds();
            if(dto.offsetSeconds()!=null){
                if(!Double.isFinite(dto.offsetSeconds())||dto.offsetSeconds()>86400)throw new IllegalArgumentException("视频时间偏移无效");
                e.occurredAt=(t.recordedAt==null?t.createdAt:t.recordedAt).plusMillis(Math.round(dto.offsetSeconds()*1000));
            }
        }
        if(e.occurredAt.isAfter(Instant.now().plusSeconds(300)))throw new IllegalArgumentException("不能补录未来事件");
        e.source="MANUAL";e.reviewStatus=ReviewStatus.CONFIRMED;e.note=dto.note();e.requestKey=dto.requestKey();e.reviewReason="OTHER";events.save(e);freshness.touch(e.stallId,e.origin,e.occurredAt);
        ReviewAudit a=new ReviewAudit();a.eventId=e.id;a.operatorName=actor.getName();a.toStatus="CONFIRMED";a.fromStatus="CREATED";a.note=dto.note();audits.save(a);return e;
    }
    @GetMapping("/audits")public List<ReviewAudit> audits(@RequestParam(defaultValue="SIMULATION")Origin origin,@RequestParam(required=false)Long eventId){
        return audits.scoped(origin,eventId,PageRequest.of(0,100));
    }
}
