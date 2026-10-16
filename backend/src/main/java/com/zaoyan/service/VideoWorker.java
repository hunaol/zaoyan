package com.zaoyan.service;
import com.fasterxml.jackson.databind.*;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import jakarta.annotation.PreDestroy;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

@Service
public class VideoWorker {
    private final VideoTaskRepository tasks;private final TaskLifecycle lifecycle;
    private final ObjectMapper mapper;private final String python,weights;private final Path aiRoot,storage;
    private final long timeout;
    private final ConcurrentMap<String,Process> processes=new ConcurrentHashMap<>();
    private final Set<String> activeTasks=ConcurrentHashMap.newKeySet();
    public VideoWorker(VideoTaskRepository tasks,TaskLifecycle lifecycle,ObjectMapper mapper,
        @Value("${app.python-bin}")String python,@Value("${app.ai-root}")String aiRoot,
        @Value("${app.storage-root}")String storage,@Value("${app.weights:}")String weights,
        @Value("${app.upload-timeout-seconds}")long timeout){
        this.tasks=tasks;this.lifecycle=lifecycle;this.mapper=mapper;this.python=python;
        this.aiRoot=Path.of(aiRoot).toAbsolutePath().normalize();this.storage=Path.of(storage).toAbsolutePath().normalize();
        this.weights=weights;this.timeout=timeout;
    }
    @Async("taskExecutor") public void run(String id){
        if(!activeTasks.add(id))return;
        VideoTask t;
        try{t=lifecycle.begin(id);}catch(RuntimeException e){activeTasks.remove(id);throw e;}
        if(t==null){activeTasks.remove(id);return;}
        Path out=storage.resolve("jobs").resolve(id+"-annotated.mp4"),result=storage.resolve("jobs").resolve(id+".result.json");
        Path progress=storage.resolve("jobs").resolve(id+".progress.json"),log=storage.resolve("jobs").resolve(id+".log");
        Process p=null;
        try{
            Files.createDirectories(out.getParent());Files.deleteIfExists(result);Files.deleteIfExists(progress);
            if(t.lineX1==null)throw new IllegalArgumentException("旧任务缺少计数线快照，请重新上传");
            if("yolo".equals(t.detector)&&(weights.isBlank()||!Files.isRegularFile(Path.of(weights))))
                throw new IllegalArgumentException("未配置可用 YOLO 权重");
            List<String> cmd=new ArrayList<>(List.of(python,"-m","zaoyan_ai.video_job","--input",t.inputPath,
                "--output",out.toString(),"--result",result.toString(),"--status",progress.toString(),"--detector",t.detector,
                "--line",t.lineX1+","+t.lineY1+","+t.lineX2+","+t.lineY2,"--direction",t.direction));
            Path config=storage.resolve("jobs").resolve(id+".rules.json");Files.writeString(config,t.getRules().json());
            cmd.add("--rules");cmd.add(config.toString());
            if("yolo".equals(t.detector)){cmd.add("--weights");cmd.add(weights);}
            p=new ProcessBuilder(cmd).directory(aiRoot.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            processes.put(id,p);
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(timeout);
            while(!p.waitFor(250,TimeUnit.MILLISECONDS)){
                if(!"RUNNING".equals(tasks.findById(id).orElseThrow().status)){kill(p);return;}
                if(System.nanoTime()>deadline)throw new IllegalStateException("视频分析超时，已终止；可检查视频后重试");
            }
            if(p.exitValue()!=0)throw new IllegalStateException("算法运行失败："+tail(log));
            if(!Files.isRegularFile(out)||Files.size(out)==0)throw new IllegalStateException("缺少结果视频");
            lifecycle.complete(id,mapper.readTree(result.toFile()),out.toString());
        }catch(Exception e){
            if(e instanceof InterruptedException)Thread.currentThread().interrupt();
            lifecycle.fail(id,e.getMessage());
        }finally{if(p!=null){kill(p);processes.remove(id,p);}activeTasks.remove(id);}
    }
    public void stop(String id){Process p=processes.get(id);if(p!=null)kill(p);}
    public boolean active(String id){return activeTasks.contains(id);}
    public static void kill(Process p){
        p.descendants().forEach(child->{try{child.destroyForcibly();}catch(Exception ignored){}});
        if(p.isAlive())p.destroyForcibly();
    }
    @PreDestroy public void shutdown(){processes.values().forEach(VideoWorker::kill);}
    private String tail(Path file){try{String s=Files.readString(file);return s.substring(Math.max(0,s.length()-350)).replaceAll("[\\r\\n]+"," ");}catch(Exception e){return "请检查 Python 依赖与视频格式";}}
}
