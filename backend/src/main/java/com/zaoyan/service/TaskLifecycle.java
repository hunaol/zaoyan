package com.zaoyan.service;
import com.fasterxml.jackson.databind.JsonNode;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.*;

@Service
public class TaskLifecycle {
    private final VideoTaskRepository tasks;
    private final CountEventRepository events;private final StallRepository stalls;private final CaptureService captures;
    public TaskLifecycle(VideoTaskRepository tasks,CountEventRepository events,StallRepository stalls,CaptureService captures){this.tasks=tasks;this.events=events;this.stalls=stalls;this.captures=captures;}
    private VideoTask locked(String id){stalls.lockById(tasks.stallOf(id).orElseThrow(()->new IllegalArgumentException("任务不存在"))).orElseThrow();return tasks.lockById(id).orElseThrow();}
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public VideoTask begin(String id){
        VideoTask t=locked(id);
        if(!"QUEUED".equals(t.status))return null;
        t.status="RUNNING";t.progress=1;return tasks.save(t);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public VideoTask retry(String id){
        VideoTask t=locked(id);
        if(!"UPLOAD".equals(t.mode)||!Set.of("FAILED","CANCELLED").contains(t.status))
            throw new IllegalArgumentException("只能重试失败或已取消的上传任务");
        if(!events.findByTaskIdOrderByOccurredAtAsc(id).isEmpty())
            throw new IllegalArgumentException("此旧任务已存在事件，请先复核，不能自动重复导入");
        t.status="QUEUED";t.progress=0;t.finishedAt=null;t.errorMessage=null;t.outputPath=null;
        t.attempt=(t.attempt==null?1:t.attempt)+1;return tasks.save(t);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public VideoTask cancel(String id){
        VideoTask t=locked(id);
        if(!"UPLOAD".equals(t.mode))throw new IllegalArgumentException("实时会话请使用停止监测操作");
        if(Set.of("QUEUED","RUNNING").contains(t.status)){
            t.status="CANCELLED";t.finishedAt=Instant.now();t.errorMessage="用户已取消本次分析，未导入事件";
        }
        return tasks.save(t);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public void fail(String id,String message){
        VideoTask t=locked(id);
        if(!Set.of("QUEUED","RUNNING").contains(t.status))return;
        t.status="FAILED";t.finishedAt=Instant.now();
        t.errorMessage=Objects.toString(message,"任务失败").substring(0,Math.min(1500,Objects.toString(message,"任务失败").length()));
        tasks.save(t);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public void complete(String id,JsonNode result,String output){
        VideoTask t=locked(id);
        if(!"RUNNING".equals(t.status))return; // Cancellation wins: import nothing.
        if(!"completed".equals(result.path("status").asText())||!result.path("events").isArray())
            throw new IllegalArgumentException("算法结果不完整");
        List<CountEvent> batch=new ArrayList<>();Set<Integer> seen=new HashSet<>();
        Instant base=t.recordedAt==null?t.createdAt:t.recordedAt;
        for(JsonNode row:result.path("events")){
            int track=row.path("track_id").asInt(-1);
            double offset=row.path("offset_seconds").asDouble(-1), confidence=row.path("confidence").asDouble(-1);
            if(track<0||!Double.isFinite(offset)||offset<0||!Double.isFinite(confidence)||confidence<0||confidence>1)
                throw new IllegalArgumentException("算法返回了无效事件");
            if(!seen.add(track)||events.existsByTaskIdAndTrackId(id,track))continue;
            CountEvent e=new CountEvent();e.taskId=id;e.stallId=t.stallId;e.origin=t.origin;
            e.trackId=track;e.offsetSeconds=offset;e.confidence=confidence;
            e.targetLabel=row.path("target_label").asText("unknown");
            e.riskReasons=riskReasons(row);
            e.occurredAt=base.plusMillis(Math.round(offset*1000));batch.add(e);
        }
        events.saveAll(batch);
        t.rawCount=seen.size();t.frameCount=result.path("frame_count").asInt();t.outputPath=output;
        t.durationSeconds=result.path("duration_seconds").asDouble(0);
        if(t.durationSeconds<=0&&result.path("fps").asDouble()>0)t.durationSeconds=t.frameCount/result.path("fps").asDouble();
        t.progress=100;t.status="COMPLETED";t.finishedAt=Instant.now();tasks.save(t);captures.completed(t);
    }
    public static String riskReasons(JsonNode row){
        java.util.List<String> codes=new java.util.ArrayList<>();
        for(JsonNode n:row.path("risk_reasons")){String code=n.asText();if(code.matches("[A-Z_]{1,40}"))codes.add(code);}
        String value=String.join(",",codes);return value.length()>500?value.substring(0,500):value;
    }
}

