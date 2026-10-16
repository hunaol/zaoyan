package com.zaoyan.web;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
@RestController @RequestMapping("/api/planning")
public class PlanningActionsController {
    private final PrepRepository prep;private final ForecastRepository forecasts;private final StallRepository stalls;
    public PlanningActionsController(PrepRepository prep,ForecastRepository forecasts,StallRepository stalls){this.prep=prep;this.forecasts=forecasts;this.stalls=stalls;}
    @PostMapping("/seed-simulation") @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Map<String,Integer> seed(@RequestParam Long stallId,@RequestParam(defaultValue="LUNCH")String mealSlot){
        if(!Set.of("BREAKFAST","LUNCH","DINNER").contains(mealSlot)||stalls.lockById(stallId).isEmpty())throw new IllegalArgumentException("档口或餐次无效");
        int[] values={113,120,107,125,118,132,123,130};int created=0;
        LocalDate today=LocalDate.now(ZoneId.of("Asia/Shanghai"));
        // The stall row lock serializes first-time inserts, including concurrent seed requests.
        for(int i=0;i<8;i++){
            LocalDate d=today.minusDays(8-i);
            if(prep.findByStallIdAndOriginAndServiceDateAndMealSlot(stallId,Origin.SIMULATION,d,mealSlot).isPresent())continue;
            PrepRecord p=new PrepRecord();p.stallId=stallId;p.origin=Origin.SIMULATION;p.serviceDate=d;p.mealSlot=mealSlot;
            p.verificationSource="SIMULATION_SEED";p.plannedQty=135;p.preparedQty=135;p.actualQty=values[i];p.note="自建模拟样本，非真实食堂经营数据";prep.save(p);created++;
        }
        return Map.of("created",created,"skipped",8-created);
    }
    @PostMapping("/apply-forecast/{id}") @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public PrepRecord apply(@PathVariable String id,@RequestParam(defaultValue="false")boolean overwrite){
        ForecastRun f=forecasts.findById(id).orElseThrow(()->new IllegalArgumentException("预测不存在"));
        if(!"COMPLETED".equals(f.status)||f.recommendedQty==null||f.targetDate==null)throw new IllegalArgumentException("预测尚未完成或缺少目标日期");
        if(f.targetDate.isBefore(LocalDate.now(ZoneId.of("Asia/Shanghai"))))throw new IllegalArgumentException("历史预测只可查看，不能应用为未来备餐计划");
        if(f.recommendedQty>100000)throw new IllegalArgumentException("建议数量超过台账单次上限，请人工拆分计划");
        stalls.lockById(f.stallId).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        if(f.sourceSnapshot!=null){
            try{for(var row:new com.fasterxml.jackson.databind.ObjectMapper().readTree(f.sourceSnapshot)){
                PrepRecord current=prep.findById(row.path("id").asLong()).orElseThrow(()->new IllegalArgumentException("预测所用台账已删除，请重新计算"));
                if(current.actualQty==null||Boolean.TRUE.equals(current.verificationStale)||current.actualQty!=row.path("quantity").asInt())
                    throw new IllegalArgumentException("预测所用台账已变化或待重新核实，请重新计算建议");
            }}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalArgumentException("预测来源快照无法读取，请重新计算");}
        }
        Optional<PrepRecord> old=prep.findByStallIdAndOriginAndServiceDateAndMealSlot(f.stallId,f.origin,f.targetDate,f.mealSlot);
        if(old.isPresent()&&!overwrite)throw new IllegalArgumentException("该日期餐次已有台账，确认覆盖计划量后再应用");
        PrepRecord p=old.orElseGet(PrepRecord::new);p.stallId=f.stallId;p.origin=f.origin;p.serviceDate=f.targetDate;p.mealSlot=f.mealSlot;
        p.revision=(p.revision==null?0:p.revision)+1;
        p.plannedQty=f.recommendedQty; // DO NOT overwrite preparedQty or actualQty.
        if(old.isEmpty())p.note="采用备餐建议 "+id.substring(0,8)+"；实际备餐与出餐须另行核实";
        return prep.save(p);
    }
}
