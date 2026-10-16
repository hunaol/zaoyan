package com.zaoyan.config;
import com.zaoyan.repo.*;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
@Component
public class TaskRecovery implements ApplicationRunner {
    private final VideoTaskRepository tasks;private final ForecastRepository forecasts;
    public TaskRecovery(VideoTaskRepository tasks,ForecastRepository forecasts){this.tasks=tasks;this.forecasts=forecasts;}
    @Override @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public void run(ApplicationArguments args){
        for(var t:tasks.findByStatusIn(List.of("RUNNING","QUEUED"))){t.status="FAILED";t.finishedAt=Instant.now();t.errorMessage="服务曾重启，旧进程已终止；上传任务可重试，实时监测请重新开启";tasks.save(t);}
        for(var f:forecasts.findByStatusIn(List.of("RUNNING","QUEUED"))){f.status="FAILED";f.finishedAt=Instant.now();f.errorMessage="服务重启中断了预测，请重新计算";forecasts.save(f);}
    }
}
