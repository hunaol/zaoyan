package com.zaoyan.web;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;import com.zaoyan.service.*;
import org.springframework.web.bind.annotation.*;import org.springframework.security.core.Authentication;
import jakarta.validation.Valid;import jakarta.validation.constraints.*;import java.time.LocalDate;
@RestController @RequestMapping("/api/settlements")
public class SettlementController {
    private final SettlementService service;private final SettlementDraftRepository drafts;
    public SettlementController(SettlementService service,SettlementDraftRepository drafts){this.service=service;this.drafts=drafts;}
    public record Create(@NotNull Long stallId,@NotNull Origin origin,@NotNull LocalDate serviceDate,
        @NotNull @Pattern(regexp="BREAKFAST|LUNCH|DINNER")String mealSlot,@Min(1)@Max(50)int portionsPerEvent){}
    @PostMapping public SettlementDraft create(@Valid @RequestBody Create i,Authentication a){return service.create(i.stallId(),i.origin(),i.serviceDate(),i.mealSlot(),i.portionsPerEvent(),a.getName());}
    public record Confirm(boolean coverageConfirmed,boolean unitsConfirmed,boolean zeroConfirmed,boolean overwrite,@NotBlank @Size(max=300)String note){}
    @PostMapping("/{id}/confirm")public PrepRecord confirm(@PathVariable String id,@Valid @RequestBody Confirm i,Authentication a){return service.confirm(id,i.coverageConfirmed(),i.unitsConfirmed(),i.zeroConfirmed(),i.overwrite(),i.note(),a.getName());}
    @GetMapping("/{id}")public SettlementDraft get(@PathVariable String id){return drafts.findById(id).orElseThrow(()->new IllegalArgumentException("草稿不存在"));}
}
