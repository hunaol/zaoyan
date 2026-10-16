package com.zaoyan.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

@Service
public class VideoService {
    private final VideoTaskRepository tasks;private final StallRepository stalls;private final VideoWorker worker;
    private final CaptureService captures;private final EventScope scope;private final TaskLifecycle lifecycle;private final ObjectMapper mapper;private final Path storage;private final String weights;
    public VideoService(VideoTaskRepository tasks,StallRepository stalls,VideoWorker worker,TaskLifecycle lifecycle,ObjectMapper mapper,CaptureService captures,EventScope scope,
        @Value("${app.storage-root}")String storageRoot,@Value("${app.weights:}")String weights){
        this.tasks=tasks;this.stalls=stalls;this.worker=worker;this.captures=captures;this.scope=scope;this.lifecycle=lifecycle;this.mapper=mapper;this.weights=weights;
        storage=Path.of(storageRoot).toAbsolutePath().normalize();
    }
    public record TaskView(String id,Long stallId,Origin origin,String mode,String detector,String status,
        String originalFilename,int progress,int rawCount,int frameCount,String errorMessage,Instant createdAt,Instant finishedAt,
        boolean hasResultVideo,boolean hasSourceVideo,Instant recordedAt,Double lineX1,Double lineY1,Double lineX2,Double lineY2,String direction,Integer attempt,String assetId,String activeTaskId,boolean statsIncluded,Double durationSeconds,CountingRules rules,boolean reusedUpload){}
    public TaskView view(VideoTask t){return view(t,false);}
    public TaskView view(VideoTask t,boolean reused){
        int progress=t.progress;
        if("RUNNING".equals(t.status)&&"UPLOAD".equals(t.mode))try{
            Path p=storage.resolve("jobs").resolve(t.id+".progress.json");
            if(Files.isRegularFile(p))progress=Math.min(99,Math.max(progress,mapper.readTree(p.toFile()).path("progress").asInt()));
        }catch(Exception ignored){}
        return new TaskView(t.id,t.stallId,t.origin,t.mode,t.detector,t.status,t.originalFilename,progress,t.rawCount,t.frameCount,
            t.errorMessage,t.createdAt,t.finishedAt,exists(t.outputPath),exists(t.inputPath),t.recordedAt==null?t.createdAt:t.recordedAt,
            t.lineX1,t.lineY1,t.lineX2,t.lineY2,t.direction,t.attempt,t.assetId,captures.activeId(t.assetId),scope.effective(t),t.durationSeconds,t.getRules(),reused);
    }
    private boolean exists(String path){return path!=null&&Path.of(path).toAbsolutePath().normalize().startsWith(storage)&&Files.isRegularFile(Path.of(path));}
    public VideoTask get(String id){return tasks.findById(id).orElseThrow(()->new IllegalArgumentException("任务不存在"));}
    public List<TaskView> list(Origin origin){return (origin==null?tasks.findTop30ByOrderByCreatedAtDesc():tasks.findTop50ByOriginOrderByCreatedAtDesc(origin)).stream().map(this::view).toList();}
    public static void validateMode(Origin origin,String detector){
        if(!Set.of("demo-color","yolo").contains(detector))throw new IllegalArgumentException("不支持的算法模式");
        if(origin==Origin.REAL&&"demo-color".equals(detector))throw new IllegalArgumentException("模拟色块算法只能写入模拟实验工作区");
    }
    public TaskView upload(MultipartFile file,Origin origin,String detector,Long stallId,Instant recordedAt,String actor)throws IOException{
        if(file.isEmpty()||file.getSize()>200L*1024*1024)throw new IllegalArgumentException("请选择不超过 200 MB 的视频");
        validateMode(origin,detector);
        if("yolo".equals(detector)&&(weights.isBlank()||!Files.isRegularFile(Path.of(weights))))throw new IllegalArgumentException("未配置可用 YOLO 权重，不能创建该任务");
        Stall s=stalls.findById(stallId).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        if(recordedAt!=null&&recordedAt.isAfter(Instant.now().plusSeconds(300)))throw new IllegalArgumentException("视频开始时间不能晚于当前时间");
        String source=Optional.ofNullable(file.getOriginalFilename()).orElse("video.mp4").replace('\\','/');
        source=source.substring(source.lastIndexOf('/')+1);
        String ext=source.contains(".")?source.substring(source.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";
        if(!Set.of("mp4","mov","avi","mkv","webm").contains(ext))throw new IllegalArgumentException("仅支持 MP4/MOV/AVI/MKV/WEBM");
        Files.createDirectories(storage.resolve("uploads"));Files.createDirectories(storage.resolve("jobs"));
        String id=UUID.randomUUID().toString();Path input=storage.resolve("uploads").resolve(id+"."+ext);
        try{file.transferTo(input);}catch(Exception e){Files.deleteIfExists(input);throw e;}
        VideoTask t=new VideoTask();t.id=id;t.stallId=stallId;t.origin=origin;t.detector=detector;t.attempt=1;t.operatorName=actor;
        t.originalFilename=source.substring(0,Math.min(200,source.length()));t.inputPath=input.toString();t.recordedAt=recordedAt==null?t.createdAt:recordedAt;
        t.lineX1=s.lineX1;t.lineY1=s.lineY1;t.lineX2=s.lineX2;t.lineY2=s.lineY2;t.direction=s.direction;t.rulesJson=s.getRules().json();
        VideoTask registered;
        try{registered=captures.register(t,CaptureService.hash(input),false);}catch(Exception e){Files.deleteIfExists(input);throw e;}
        if(!registered.id.equals(t.id)){Files.deleteIfExists(input);return view(registered,true);}
        submit(t.id);return view(get(t.id));
    }
    public TaskView reanalyze(String id,String actor)throws IOException{
        VideoTask old=get(id);if(!"UPLOAD".equals(old.mode)||!exists(old.inputPath))throw new IllegalArgumentException("原始上传录像不可用");
        Stall s=stalls.findById(old.stallId).orElseThrow();VideoTask t=new VideoTask();
        t.id=UUID.randomUUID().toString();t.stallId=old.stallId;t.origin=old.origin;t.detector=old.detector;
        t.originalFilename=old.originalFilename;t.inputPath=old.inputPath;t.recordedAt=old.recordedAt==null?old.createdAt:old.recordedAt;t.operatorName=actor;t.attempt=1;
        t.lineX1=s.lineX1;t.lineY1=s.lineY1;t.lineX2=s.lineX2;t.lineY2=s.lineY2;t.direction=s.direction;t.rulesJson=s.getRules().json();
        t=captures.register(t,CaptureService.hash(Path.of(t.inputPath)),true);submit(t.id);return view(get(t.id));
    }
    public TaskView activate(String id,String actor,String note){return view(captures.activate(id,actor,note));}
    public Map<String,Object> search(Origin origin,String mode,String status,java.time.LocalDate date,String q,int page,int size){
        if(q.length()>100)throw new IllegalArgumentException("查询过长");
        org.springframework.data.jpa.domain.Specification<VideoTask> spec=(r,query,c)->{
            var p=new ArrayList<jakarta.persistence.criteria.Predicate>();p.add(c.equal(r.get("origin"),origin));
            if(mode!=null&&!mode.isBlank())p.add(c.equal(r.get("mode"),mode));
            if(status!=null&&!status.isBlank())p.add(c.equal(r.get("status"),status));
            if(date!=null){var zone=java.time.ZoneId.of("Asia/Shanghai");p.add(c.greaterThanOrEqualTo(r.get("recordedAt"),date.atStartOfDay(zone).toInstant()));p.add(c.lessThan(r.get("recordedAt"),date.plusDays(1).atStartOfDay(zone).toInstant()));}
            if(!q.isBlank()){String term="%"+q.trim().toLowerCase(Locale.ROOT).replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%";p.add(c.or(c.like(c.lower(r.get("originalFilename")),term,'\\'),c.like(c.lower(r.get("id")),term,'\\')));}
            return c.and(p.toArray(new jakarta.persistence.criteria.Predicate[0]));
        };
        return PageViews.of(tasks.findAll(spec,PageViews.request(page,size)).map(this::view));
    }
    private void submit(String id){try{worker.run(id);}catch(RuntimeException e){lifecycle.fail(id,"任务队列暂时繁忙，请稍后重试");}}
    public synchronized TaskView retry(String id){
        VideoTask old=get(id);if(!exists(old.inputPath))throw new IllegalArgumentException("原始视频已不存在，请重新上传");
        if(worker.active(id))throw new IllegalArgumentException("上次进程正在退出，请稍后重试");
        if(old.lineX1==null)throw new IllegalArgumentException("旧版任务无计数线快照，请重新上传");
        lifecycle.retry(id);submit(id);return view(get(id));
    }
    public TaskView cancel(String id){VideoTask t=lifecycle.cancel(id);if("CANCELLED".equals(t.status))worker.stop(id);return view(t);}
    public ResponseEntity<FileSystemResource> video(String id,boolean source){
        VideoTask t=get(id);String name=source?t.inputPath:t.outputPath;
        if(!exists(name))throw new IllegalArgumentException(source?"原始视频不存在":"尚无可播放结果视频");
        String type="video/mp4";
        if(source){String lower=name.toLowerCase(Locale.ROOT);if(lower.endsWith(".webm"))type="video/webm";else if(lower.endsWith(".mov"))type="video/quicktime";else if(lower.endsWith(".avi"))type="video/x-msvideo";else if(lower.endsWith(".mkv"))type="video/x-matroska";}
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type)).header(HttpHeaders.CACHE_CONTROL,"private, no-store").body(new FileSystemResource(name));
    }
}
