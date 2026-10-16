package com.zaoyan.web;

import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.*;

@RestController @RequestMapping("/api/prep")
public class PrepController {
    private final PrepRepository prep;private final StallRepository stalls;
    public PrepController(PrepRepository prep,StallRepository stalls){this.prep=prep;this.stalls=stalls;}
    @GetMapping public List<PrepRecord> list(@RequestParam(defaultValue="SIMULATION")Origin origin){return prep.findByOriginOrderByServiceDateDesc(origin);}
    public record Input(@NotNull Long stallId,@NotNull Origin origin,@NotNull LocalDate serviceDate,
      @NotBlank @Pattern(regexp="BREAKFAST|LUNCH|DINNER")String mealSlot,
      @Min(0) @Max(100000)int plannedQty,@Min(0) @Max(100000)int preparedQty,
      @Min(0) @Max(100000)Integer actualQty,@Size(max=300)String note,Long expectedRevision,boolean manualOverride){}
    @PostMapping @org.springframework.transaction.annotation.Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public PrepRecord upsert(@Valid @RequestBody Input input,org.springframework.security.core.Authentication actor){
        if(stalls.lockById(input.stallId()).isEmpty())throw new IllegalArgumentException("档口不存在");
        if(input.actualQty()!=null&&input.serviceDate().isAfter(LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"))))
            throw new IllegalArgumentException("未来日期不能填报已经核实的实际出餐量");
        PrepRecord r=prep.findByStallIdAndOriginAndServiceDateAndMealSlot(input.stallId(),input.origin(),input.serviceDate(),input.mealSlot())
              .orElseGet(PrepRecord::new);
        if(input.expectedRevision()!=null&&!Objects.equals(input.expectedRevision(),r.revision==null?0:r.revision))throw new IllegalArgumentException("台账已被其他操作修改，请刷新后再保存");
        boolean derived="REVIEW_SETTLEMENT".equals(r.verificationSource);
        if(derived&&!Objects.equals(r.actualQty,input.actualQty())&&!input.manualOverride())throw new IllegalArgumentException("这是事件结算台账；修改核实量需明确选择人工重新核实");
        if(!derived||input.manualOverride()){
            if(input.manualOverride()&&(input.note()==null||input.note().isBlank()))throw new IllegalArgumentException("人工重新核实须说明依据");
            r.verificationSource="MANUAL";r.sourceDraftId=null;r.sourceDigest=null;r.sourceEventCount=null;r.portionsPerEvent=null;
            r.verificationStale=false;r.verifiedAt=input.actualQty()==null?null:java.time.Instant.now();r.verifiedBy=actor.getName();
        }
        r.revision=(r.revision==null?0:r.revision)+1;
        r.stallId=input.stallId();r.origin=input.origin();r.serviceDate=input.serviceDate();r.mealSlot=input.mealSlot();
        r.plannedQty=input.plannedQty();r.preparedQty=input.preparedQty();r.actualQty=input.actualQty();r.note=input.note();
        return prep.save(r);
    }
}
