package com.zaoyan.service;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;
import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import java.util.*;

@Service public class CaptureService {
    private final CaptureAssetRepository assets;private final VideoTaskRepository tasks;private final StallRepository stalls;
    private final CountEventRepository events;private final LedgerFreshness freshness;private final BusinessLog log;
    public CaptureService(CaptureAssetRepository assets,VideoTaskRepository tasks,StallRepository stalls,
        CountEventRepository events,LedgerFreshness freshness,BusinessLog log){
        this.assets=assets;this.tasks=tasks;this.stalls=stalls;this.events=events;this.freshness=freshness;this.log=log;
    }
    public static String hash(Path path)throws java.io.IOException {
        try{MessageDigest d=MessageDigest.getInstance("SHA-256");try(var in=Files.newInputStream(path)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}return HexFormat.of().formatHex(d.digest());}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    public static String digest(String text){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
    public static String key(Long stallId,Origin origin,String hash){return digest(stallId+":"+origin+":"+hash);}
    /** Single stall row serializes concurrent first uploads, activations, reviews and settlements. */
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public VideoTask register(VideoTask candidate,String hash,boolean forceNewVersion){
        stalls.lockById(candidate.stallId).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        String key=key(candidate.stallId,candidate.origin,hash);
        CaptureAsset a=assets.findById(key).orElse(null);
        if(a!=null&&!forceNewVersion){
            if(a.activeTaskId!=null){var active=tasks.findById(a.activeTaskId);if(active.isPresent())return active.get();}
            var old=tasks.findByAssetIdOrderByCreatedAtDesc(key);if(!old.isEmpty())return old.get(0);
        }
        if(a==null){a=new CaptureAsset();a.id=key;a.stallId=candidate.stallId;a.origin=candidate.origin;a.sha256=hash;a.recordedAt=candidate.recordedAt;assets.save(a);}
        candidate.assetId=key;candidate.recordedAt=a.recordedAt;
        return tasks.save(candidate);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public void completed(VideoTask t){
        if(t.assetId!=null){CaptureAsset a=assets.findById(t.assetId).orElseThrow();if(a.activeTaskId==null){a.activeTaskId=t.id;assets.save(a);}if(!t.id.equals(a.activeTaskId))return;}
        freshness.captureChanged(t);
        for(CountEvent e:events.findByTaskIdOrderByOccurredAtAsc(t.id))freshness.touch(e.stallId,e.origin,e.occurredAt);
    }
    @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public VideoTask activate(String id,String actor,String reason){
        Long stallId=tasks.stallOf(id).orElseThrow(()->new IllegalArgumentException("任务不存在"));stalls.lockById(stallId).orElseThrow();
        VideoTask t=tasks.lockById(id).orElseThrow();
        if(t.assetId==null||!"COMPLETED".equals(t.status))throw new IllegalArgumentException("仅已完成且已登记素材的上传任务可切换统计版本");
        if(reason==null||reason.isBlank()||reason.length()>300)throw new IllegalArgumentException("请填写切换原因（1—300 字）");
        CaptureAsset a=assets.findById(t.assetId).orElseThrow();String previous=a.activeTaskId;
        if(id.equals(previous))return t;
        a.activeTaskId=id;assets.save(a);freshness.captureChanged(t);
        if(previous!=null)tasks.findById(previous).ifPresent(freshness::captureChanged);
        if(previous!=null)for(CountEvent e:events.findByTaskIdOrderByOccurredAtAsc(previous))freshness.touch(e.stallId,e.origin,e.occurredAt);
        for(CountEvent e:events.findByTaskIdOrderByOccurredAtAsc(id))freshness.touch(e.stallId,e.origin,e.occurredAt);
        log.add(stallId,t.origin,"ACTIVATE_ANALYSIS",id,actor,"统计版本 "+previous+" → "+id+"；"+reason+"。旧事件及其复核记录保留。");return t;
    }
    public String activeId(String assetId){return assetId==null?null:assets.findById(assetId).map(a->a.activeTaskId).orElse(null);}
}
