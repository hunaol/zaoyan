package com.zaoyan.web;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import com.zaoyan.service.ForecastWorker;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.util.*;
@RestController @RequestMapping("/api/forecasts")
public class ForecastController {
    private final ForecastRepository forecasts;private final StallRepository stalls;private final ForecastWorker worker;
    public ForecastController(ForecastRepository forecasts,StallRepository stalls,ForecastWorker worker){this.forecasts=forecasts;this.stalls=stalls;this.worker=worker;}
    public record Input(@NotNull Long stallId,@NotNull Origin origin,@NotBlank @Pattern(regexp="BREAKFAST|LUNCH|DINNER")String mealSlot,
        @DecimalMin("0.0") @DecimalMax("0.5")double bufferRate,LocalDate targetDate){}
    @PostMapping public ForecastRun start(@Valid @RequestBody Input i){
        if(!stalls.existsById(i.stallId()))throw new IllegalArgumentException("档口不存在");
        LocalDate target=i.targetDate()==null?LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1):i.targetDate();
        if(target.isAfter(LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(90)))throw new IllegalArgumentException("预测日期不能超过未来 90 天");
        ForecastRun f=new ForecastRun();f.id=UUID.randomUUID().toString();f.stallId=i.stallId();f.origin=i.origin();f.mealSlot=i.mealSlot();f.bufferRate=i.bufferRate();f.targetDate=target;
        forecasts.save(f);
        try{worker.run(f.id);}catch(RuntimeException e){f.status="FAILED";f.errorMessage="队列繁忙，请稍后重试";f.finishedAt=Instant.now();forecasts.save(f);}
        return f;
    }
    @GetMapping("/search")public Object search(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(defaultValue="LUNCH")String mealSlot,@RequestParam(required=false)String status,
        @RequestParam(required=false)LocalDate targetDate,@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="10")int size){
        org.springframework.data.jpa.domain.Specification<ForecastRun> spec=(r,q,c)->{
            var p=new ArrayList<jakarta.persistence.criteria.Predicate>();p.add(c.equal(r.get("origin"),origin));p.add(c.equal(r.get("mealSlot"),mealSlot));
            if(status!=null&&!status.isBlank())p.add(c.equal(r.get("status"),status));if(targetDate!=null)p.add(c.equal(r.get("targetDate"),targetDate));
            return c.and(p.toArray(new jakarta.persistence.criteria.Predicate[0]));};
        return com.zaoyan.service.PageViews.of(forecasts.findAll(spec,com.zaoyan.service.PageViews.request(page,size)));
    }
    @GetMapping public List<ForecastRun> history(@RequestParam(defaultValue="SIMULATION")Origin origin,@RequestParam(defaultValue="LUNCH")String mealSlot){
        if(!Set.of("BREAKFAST","LUNCH","DINNER").contains(mealSlot))throw new IllegalArgumentException("餐次无效");
        return forecasts.findTop30ByOriginAndMealSlotOrderByCreatedAtDesc(origin,mealSlot);
    }
    @GetMapping("/{id}")public ForecastRun get(@PathVariable String id){return forecasts.findById(id).orElseThrow(()->new IllegalArgumentException("预测任务不存在"));}
}
