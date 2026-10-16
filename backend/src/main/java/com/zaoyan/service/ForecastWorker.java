package com.zaoyan.service;

import com.fasterxml.jackson.databind.*;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import java.nio.file.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Service
public class ForecastWorker {
    private final PrepRepository prep;private final ForecastRepository forecasts;private final ObjectMapper mapper;
    private final String python;private final Path aiRoot,storage;
    public ForecastWorker(PrepRepository prep,ForecastRepository forecasts,ObjectMapper mapper,
      @Value("${app.python-bin}")String python,@Value("${app.ai-root}")String aiRoot,
      @Value("${app.storage-root}")String storage){
        this.prep=prep;this.forecasts=forecasts;this.mapper=mapper;this.python=python;
        this.aiRoot=Path.of(aiRoot).toAbsolutePath().normalize();this.storage=Path.of(storage).toAbsolutePath().normalize();
    }
    @Async("taskExecutor") public void run(String id){
        ForecastRun f=forecasts.findById(id).orElseThrow();f.status="RUNNING";forecasts.save(f);
        Process process=null;
        try {
            Files.createDirectories(storage.resolve("jobs"));
            var sourceRows=prep.findByOriginAndMealSlotAndActualQtyIsNotNullOrderByServiceDateAsc(f.origin,f.mealSlot)
                    .stream().filter(p->!Boolean.TRUE.equals(p.verificationStale)).filter(p->p.stallId.equals(f.stallId)&&p.serviceDate.isBefore(f.targetDate)&&!p.serviceDate.isAfter(LocalDate.now(ZoneId.of("Asia/Shanghai"))))
                    .toList();
            f.sourceSnapshot=mapper.writeValueAsString(sourceRows.stream().map(p->Map.of("id",p.id,"date",p.serviceDate.toString(),"quantity",p.actualQty,"source",Objects.toString(p.verificationSource,"MANUAL"))).toList());
            forecasts.save(f);
            var examples=sourceRows.stream().map(p->Map.of("date",p.serviceDate.toString(),"quantity",p.actualQty)).toList();
            Path input=storage.resolve("jobs").resolve(id+"-forecast-input.json");
            Path output=storage.resolve("jobs").resolve(id+"-forecast-output.json");
            mapper.writeValue(input.toFile(),Map.of("samples",examples,"buffer_rate",f.bufferRate,"target_date",f.targetDate.toString()));
            Process p=new ProcessBuilder(python,"-m","zaoyan_ai.forecast","--input",input.toString(),"--output",output.toString())
                     .directory(aiRoot.toFile()).redirectErrorStream(true).redirectOutput(storage.resolve("jobs").resolve(id+"-forecast.log").toFile()).start();
            process=p;
            if(!p.waitFor(30,TimeUnit.SECONDS)){p.destroyForcibly();throw new IllegalStateException("预测任务超时");}
            if(p.exitValue()!=0)throw new IllegalStateException("预测算法执行失败，请查看运行日志");
            JsonNode r=mapper.readTree(output.toFile());f.sampleSize=r.path("sample_size").asInt();
            if(!r.path("enough_data").asBoolean()){
                f.status="INSUFFICIENT";f.explanation=r.path("explanation").asText();
            }else{
                f.status="COMPLETED";f.predictedQty=r.path("predicted_qty").asInt();
                f.recommendedQty=r.path("recommended_qty").asInt();f.explanation=r.path("explanation").asText();
                f.lowerQty=r.path("lower_qty").asInt();f.upperQty=r.path("upper_qty").asInt();f.method=r.path("method").asText();
                f.historyStart=LocalDate.parse(r.path("history_start").asText());f.historyEnd=LocalDate.parse(r.path("history_end").asText());
            }
            f.finishedAt=Instant.now();forecasts.save(f);
        }catch(Exception e){if(e instanceof InterruptedException)Thread.currentThread().interrupt();f.status="FAILED";String message=Objects.toString(e.getMessage(),"预测失败");f.errorMessage=message.substring(0,Math.min(390,message.length()));f.finishedAt=Instant.now();forecasts.save(f);}
        finally{if(process!=null&&process.isAlive())VideoWorker.kill(process);}
    }
}
