package com.zaoyan.service;
import com.zaoyan.domain.*;
import com.zaoyan.repo.PrepRepository;
import org.springframework.stereotype.Service;
import java.time.*;
/** Call under the stall lock, in the same transaction as source changes. Never silently rewrite quantities. */
@Service public class LedgerFreshness {
    private final PrepRepository prep;
    public LedgerFreshness(PrepRepository prep){this.prep=prep;}
    public void touch(Long stallId,Origin origin,Instant when){
        if(when==null)return;
        for(PrepRecord p:prep.findByStallIdAndOriginAndServiceDate(stallId,origin,when.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate()))
            if("REVIEW_SETTLEMENT".equals(p.verificationSource)&&!Boolean.TRUE.equals(p.verificationStale)){
                p.verificationStale=true;p.revision=(p.revision==null?0:p.revision)+1;prep.save(p);
            }
    }
    public void captureChanged(VideoTask task){
        Instant from=task.recordedAt==null?task.createdAt:task.recordedAt;
        if(from==null)return;
        Instant until=task.durationSeconds!=null&&Double.isFinite(task.durationSeconds)&&task.durationSeconds>0
            ?from.plusMillis(Math.round(task.durationSeconds*1000)):from;
        ZoneId zone=ZoneId.of("Asia/Shanghai");
        LocalDate last=until.atZone(zone).toLocalDate();
        for(LocalDate day=from.atZone(zone).toLocalDate();!day.isAfter(last);day=day.plusDays(1))
            touch(task.stallId,task.origin,day.atStartOfDay(zone).toInstant());
    }
    public void configurationChanged(Long stallId){
        for(PrepRecord p:prep.findByStallIdAndVerificationSource(stallId,"REVIEW_SETTLEMENT")){
            p.verificationStale=true;p.revision=(p.revision==null?0:p.revision)+1;prep.save(p);
        }
    }
}
