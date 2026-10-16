package com.zaoyan.web;

import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@RestController @RequestMapping("/api")
public class DashboardController {
    private static final ZoneId ZONE=ZoneId.of("Asia/Shanghai");
    private final CountEventRepository events;private final PrepRepository prep;private final com.zaoyan.service.EventScope scope;
    public DashboardController(CountEventRepository events,PrepRepository prep,com.zaoyan.service.EventScope scope){this.events=events;this.prep=prep;this.scope=scope;}
    private List<CountEvent> dayEvents(Origin origin,LocalDate date){
        return new ArrayList<>(scope.effective(events.findByOriginAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(origin,date.atStartOfDay(ZONE).toInstant(),date.plusDays(1).atStartOfDay(ZONE).toInstant())));
    }
    private boolean counted(CountEvent e){return e.reviewStatus!=ReviewStatus.REJECTED;}
    @GetMapping("/dashboard") public Map<String,Object> dashboard(@RequestParam(defaultValue="SIMULATION")Origin origin){
        LocalDate today=LocalDate.now(ZONE);
        List<CountEvent> list=dayEvents(origin,today);
        long valid=list.stream().filter(this::counted).count();
        long pending=list.stream().filter(e->e.reviewStatus==ReviewStatus.PENDING).count();
        long confirmed=list.stream().filter(e->e.reviewStatus==ReviewStatus.CONFIRMED).count();
        long auto=list.stream().filter(e->e.source.equals("AUTO")).count();
        List<Map<String,Object>> trend=new ArrayList<>();
        for(int i=6;i>=0;i--){LocalDate date=today.minusDays(i);
            long count=dayEvents(origin,date).stream().filter(this::counted).count();
            trend.add(Map.of("date",date.toString(),"label",date.format(DateTimeFormatter.ofPattern("MM/dd")),"count",count));
        }
        List<Map<String,Object>> hourly=new ArrayList<>();
        for(int hour=0;hour<24;hour++){
            int h=hour;
            long n=list.stream().filter(this::counted).filter(e->e.occurredAt.atZone(ZONE).getHour()==h).count();
            hourly.add(Map.of("hour",String.format("%02d:00",hour),"count",n));
        }
        int prepared=prep.findByOriginOrderByServiceDateDesc(origin).stream().filter(r->today.equals(r.serviceDate))
            .mapToInt(r->r.preparedQty).sum();
        return Map.of("origin",origin,"date",today,"todayCount",valid,"pendingCount",pending,
            "confirmedCount",confirmed,"autoEvents",auto,"preparedCount",prepared,
            "trend",trend,"hourly",hourly,"recentEvents",list.stream().sorted(Comparator.comparing((CountEvent e)->e.occurredAt).reversed()).limit(5).toList());
    }
    @GetMapping("/reports/daily") public Map<String,Object> daily(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(required=false)LocalDate date){
        LocalDate reportDate=date==null?LocalDate.now(ZONE):date;
        List<CountEvent> list=dayEvents(origin,reportDate);
        long accepted=list.stream().filter(this::counted).count();
        long rejected=list.stream().filter(e->e.reviewStatus==ReviewStatus.REJECTED).count();
        long confirmed=list.stream().filter(e->e.reviewStatus==ReviewStatus.CONFIRMED).count();
        List<PrepRecord> preparations=prep.findByOriginOrderByServiceDateDesc(origin).stream().filter(p->p.serviceDate.equals(reportDate)).toList();
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("date",reportDate);result.put("origin",origin);result.put("count",accepted);result.put("confirmed",confirmed);
        result.put("rejected",rejected);result.put("pending",list.size()-confirmed-rejected);result.put("preparations",preparations);
        list.sort(Comparator.comparing((CountEvent e)->e.occurredAt).thenComparing(e->e.id));
        result.put("events",list);
        List<Map<String,Object>> hourly=new ArrayList<>();
        for(int h=0;h<24;h++){int hour=h;hourly.add(Map.of("hour",String.format("%02d:00",h),"count",list.stream().filter(this::counted).filter(e->e.occurredAt.atZone(ZONE).getHour()==hour).count()));}
        result.put("hourly",hourly);
        result.put("preparedQty",preparations.stream().mapToInt(p->p.preparedQty).sum());
        result.put("verifiedQty",preparations.stream().filter(p->p.actualQty!=null&&!Boolean.TRUE.equals(p.verificationStale)).mapToInt(p->p.actualQty).sum());
        result.put("unverifiedMeals",preparations.stream().filter(p->p.actualQty==null||Boolean.TRUE.equals(p.verificationStale)).count());
        result.put("staleMeals",preparations.stream().filter(p->Boolean.TRUE.equals(p.verificationStale)).count());
        result.put("balanceQty",preparations.stream().filter(p->p.actualQty!=null&&!Boolean.TRUE.equals(p.verificationStale)).mapToInt(p->p.preparedQty-p.actualQty).sum());
        return result;
    }
    @GetMapping(value="/reports/summary.csv",produces="text/csv;charset=UTF-8")
    public ResponseEntity<byte[]> summary(@RequestParam(defaultValue="SIMULATION")Origin origin,@RequestParam(required=false)LocalDate date){
        LocalDate d=date==null?LocalDate.now(ZONE):date;Map<String,Object> report=daily(origin,d);
        StringBuilder sb=new StringBuilder("\uFEFF日期,数据域,指标,数量\r\n");
        String[] fields={"count","confirmed","pending","rejected","preparedQty","verifiedQty","unverifiedMeals","balanceQty"};
        String[] labels={"初步有效事件（次）","已确认事件（次）","待复核（条）","已剔除（条）","实际备餐（份）","已填报核实出餐（份）","未核实餐次（个）","已核实餐次备餐减出餐差额（份，非实测浪费）"};
        for(int i=0;i<fields.length;i++)sb.append(d).append(',').append(origin).append(',').append(labels[i]).append(',').append(report.get(fields[i])).append("\r\n");
        sb.append("\r\n餐次,计划备餐,实际备餐,核实出餐,备餐减出餐（非实测浪费）\r\n");
        for(PrepRecord p:prep.findByOriginOrderByServiceDateDesc(origin))if(d.equals(p.serviceDate))sb.append(p.mealSlot).append(',').append(p.plannedQty).append(',').append(p.preparedQty).append(',').append(Boolean.TRUE.equals(p.verificationStale)?"来源变化需重新核实":p.actualQty==null?"未填报":p.actualQty).append(',').append(p.actualQty==null||Boolean.TRUE.equals(p.verificationStale)?"未核实":p.preparedQty-p.actualQty).append("\r\n");
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=zaoyan-summary-"+d+".csv").body(sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    @GetMapping(value="/reports/export.csv",produces="text/csv;charset=UTF-8")
    public ResponseEntity<byte[]> export(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(required=false)LocalDate date){
        if(date==null)date=LocalDate.now(ZONE);
        StringBuilder sb=new StringBuilder("\uFEFF时间,数据域,来源,目标ID,审核状态,任务ID\r\n");
        for(CountEvent e:dayEvents(origin,date)){
            sb.append(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").format(e.occurredAt.atZone(ZONE))).append(',')
                .append(e.origin).append(',').append(e.source).append(',')
                .append(e.trackId==null?"":e.trackId).append(',').append(e.reviewStatus).append(',')
                .append(e.taskId==null?"":e.taskId).append("\r\n");
        }
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=zaoyan-"+date+".csv")
            .body(sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
