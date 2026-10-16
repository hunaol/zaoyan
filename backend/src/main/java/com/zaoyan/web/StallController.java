package com.zaoyan.web;

import com.zaoyan.domain.Stall;
import com.zaoyan.repo.StallRepository;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;

@RestController @RequestMapping("/api/stalls")
public class StallController {
    private final StallRepository repo;private final com.zaoyan.service.LedgerFreshness freshness;private final com.zaoyan.service.BusinessLog log;
    public StallController(StallRepository repo,com.zaoyan.service.LedgerFreshness freshness,com.zaoyan.service.BusinessLog log){this.repo=repo;this.freshness=freshness;this.log=log;}
    @GetMapping public List<Stall> list(){return repo.findAll();}
    public record Update(@NotBlank @Size(max=90) String name, @NotBlank @Size(max=90) String location,
        @DecimalMin("0.0") @DecimalMax("1.0") double lineX1,
        @DecimalMin("0.0") @DecimalMax("1.0") double lineY1,
        @DecimalMin("0.0") @DecimalMax("1.0") double lineX2,
        @DecimalMin("0.0") @DecimalMax("1.0") double lineY2,
        @NotBlank @Pattern(regexp="positive|negative") String direction,com.zaoyan.domain.CountingRules rules){}
    @PutMapping("/{id}") @PreAuthorize("hasRole('ADMIN')")
    @org.springframework.transaction.annotation.Transactional
    public Stall edit(@PathVariable Long id,@Valid @RequestBody Update dto,org.springframework.security.core.Authentication actor){
        Stall s=repo.lockById(id).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        if(Math.hypot(dto.lineX2-dto.lineX1,dto.lineY2-dto.lineY1)<0.1)throw new IllegalArgumentException("计数线过短");
        s.name=dto.name();s.location=dto.location();s.lineX1=dto.lineX1();s.lineY1=dto.lineY1();s.lineX2=dto.lineX2();s.lineY2=dto.lineY2();s.direction=dto.direction();
        var rules=dto.rules()==null?s.getRules():dto.rules();rules.validate(s.lineX1,s.lineY1,s.lineX2,s.lineY2);
        if(!s.getRules().meals().equals(rules.meals()))freshness.configurationChanged(id);
        s.rulesJson=rules.json();
        log.add(id,null,"SAVE_RULES",id.toString(),actor.getName(),"保存识别区域、计数线、目标类别、稳定帧和餐次配置。只影响新任务，既有快照不变。");
        return repo.save(s);
    }
}
