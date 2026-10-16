package com.zaoyan.web;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;import com.zaoyan.service.PageViews;
import org.springframework.web.bind.annotation.*;import org.springframework.data.domain.*;import org.springframework.data.jpa.domain.Specification;
import java.time.*;import java.util.*;
@RestController @RequestMapping("/api")
public class AuditHistoryController {
    private final ReviewAuditRepository reviews;private final BusinessAuditRepository business;
    public AuditHistoryController(ReviewAuditRepository reviews,BusinessAuditRepository business){this.reviews=reviews;this.business=business;}
    @GetMapping("/audits/search")public Object search(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(required=false)Long eventId,@RequestParam(required=false)LocalDate date,
        @RequestParam(defaultValue="")String q,@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="20")int size){
        PageViews.request(page,size);if(q.length()>100)throw new IllegalArgumentException("查询过长");
        Specification<ReviewAudit> spec=(r,query,c)->{
            var p=new ArrayList<jakarta.persistence.criteria.Predicate>();var sub=query.subquery(Long.class);var e=sub.from(CountEvent.class);
            sub.select(e.get("id")).where(c.equal(e.get("origin"),origin));p.add(r.get("eventId").in(sub));
            if(eventId!=null)p.add(c.equal(r.get("eventId"),eventId));
            if(date!=null){var zone=ZoneId.of("Asia/Shanghai");p.add(c.greaterThanOrEqualTo(r.get("operatedAt"),date.atStartOfDay(zone).toInstant()));p.add(c.lessThan(r.get("operatedAt"),date.plusDays(1).atStartOfDay(zone).toInstant()));}
            if(!q.isBlank()){String term="%"+q.trim().replace("%","\\%").replace("_","\\_")+"%";p.add(c.or(c.like(r.get("operatorName"),term,'\\'),c.like(r.get("note"),term,'\\')));}
            return c.and(p.toArray(new jakarta.persistence.criteria.Predicate[0]));};
        return PageViews.of(reviews.findAll(spec,PageRequest.of(page,size,Sort.by(Sort.Order.desc("operatedAt"),Sort.Order.desc("id")))));
    }
    @GetMapping("/business-audits")public Object business(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="20")int size){
        PageViews.request(page,size);
        Specification<BusinessAudit> spec=(r,q,c)->c.or(c.equal(r.get("origin"),origin),c.isNull(r.get("origin")));
        return PageViews.of(business.findAll(spec,PageRequest.of(page,size,Sort.by(Sort.Order.desc("operatedAt"),Sort.Order.desc("id")))));
    }
}
