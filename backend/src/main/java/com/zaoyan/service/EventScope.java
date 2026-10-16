package com.zaoyan.service;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.stereotype.Service;
import java.util.*;
/** A view-only flag. Never deletes excluded analysis versions or their review history. */
@Service public class EventScope {
    private final VideoTaskRepository tasks;private final CaptureAssetRepository assets;
    public EventScope(VideoTaskRepository tasks,CaptureAssetRepository assets){this.tasks=tasks;this.assets=assets;}
    public boolean effective(VideoTask t){
        if("UPLOAD".equals(t.mode)&&!"COMPLETED".equals(t.status))return false;
        return t.assetId==null||assets.findById(t.assetId).map(a->t.id.equals(a.activeTaskId)).orElse(false);
    }
    public <T extends Collection<CountEvent>> T decorate(T rows){
        Map<String,Boolean> cached=new HashMap<>();
        for(CountEvent e:rows)e.statsIncluded=e.taskId==null||cached.computeIfAbsent(e.taskId,id->tasks.findById(id).map(this::effective).orElse(false));
        return rows;
    }
    public List<CountEvent> effective(List<CountEvent> rows){decorate(rows);return rows.stream().filter(e->e.statsIncluded).toList();}
}
