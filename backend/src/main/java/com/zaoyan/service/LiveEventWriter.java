package com.zaoyan.service;
import com.fasterxml.jackson.databind.JsonNode;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
@Service
public class LiveEventWriter {
    private final VideoTaskRepository tasks;private final CountEventRepository events;private final StallRepository stalls;private final LedgerFreshness freshness;
    public LiveEventWriter(VideoTaskRepository tasks,CountEventRepository events,StallRepository stalls,LedgerFreshness freshness){this.tasks=tasks;this.events=events;this.stalls=stalls;this.freshness=freshness;}
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public int append(String id,JsonNode rows){
        stalls.lockById(tasks.stallOf(id).orElseThrow()).orElseThrow();VideoTask t=tasks.lockById(id).orElseThrow();
        if(!"RUNNING".equals(t.status))throw new IllegalArgumentException("会话已结束");
        if(!rows.isArray())throw new IllegalArgumentException("实时事件格式错误");
        for(JsonNode row:rows){
            int track=row.path("track_id").asInt(-1);double confidence=row.path("confidence").asDouble(-1);
            if(track<0||!Double.isFinite(confidence)||confidence<0||confidence>1)throw new IllegalArgumentException("实时事件无效");
            if(events.existsByTaskIdAndTrackId(id,track))continue;
            CountEvent e=new CountEvent();e.taskId=id;e.stallId=t.stallId;e.origin=t.origin;e.trackId=track;e.confidence=confidence;e.occurredAt=Instant.now();
            e.targetLabel=row.path("target_label").asText("unknown");e.riskReasons=TaskLifecycle.riskReasons(row);
            events.save(e);freshness.touch(e.stallId,e.origin,e.occurredAt);t.rawCount++;
        }
        t.frameCount++;tasks.save(t);return t.rawCount;
    }
}
