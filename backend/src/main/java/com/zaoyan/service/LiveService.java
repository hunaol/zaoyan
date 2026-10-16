package com.zaoyan.service;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.security.access.AccessDeniedException;
import jakarta.annotation.PreDestroy;
import java.io.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

@Service
public class LiveService {
    private final ConcurrentMap<String,Session> sessions=new ConcurrentHashMap<>();
    private final ObjectMapper mapper;private final StallRepository stalls;private final VideoTaskRepository tasks;
    private final LiveEventWriter eventWriter;private final String python,weights;private final Path aiRoot,storage;private final int maxSessions;
    public LiveService(ObjectMapper mapper,StallRepository stalls,VideoTaskRepository tasks,LiveEventWriter eventWriter,
        @Value("${app.python-bin}")String python,@Value("${app.ai-root}")String aiRoot,@Value("${app.weights:}")String weights,
        @Value("${app.storage-root}")String storage,@Value("${app.max-live-sessions}")int maxSessions){
        this.mapper=mapper;this.stalls=stalls;this.tasks=tasks;this.eventWriter=eventWriter;this.python=python;this.weights=weights;
        this.aiRoot=Path.of(aiRoot).toAbsolutePath().normalize();this.storage=Path.of(storage).toAbsolutePath().normalize();this.maxSessions=maxSessions;
    }
    public record Started(String sessionId,String detector,Origin origin,String message){}
    private static class Session {
        String id,owner;Process process;BufferedReader reader;BufferedWriter writer;
        ExecutorService io=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"zaoyan-live-io");t.setDaemon(true);return t;});
        volatile long lastSeen=System.currentTimeMillis();volatile boolean closed;
        void close(){
            closed=true;if(process!=null)VideoWorker.kill(process);io.shutdownNow();
            // Kill before closing readLine's stream: closing a busy BufferedReader first may block.
            try{reader.close();}catch(Exception ignored){}try{writer.close();}catch(Exception ignored){}
        }
    }
    private String exchange(Session s,String input,long seconds)throws Exception{
        Future<String> job=s.io.submit(()->{
            if(input!=null){s.writer.write(input);s.writer.newLine();s.writer.flush();}
            return s.reader.readLine();
        });
        try{return job.get(seconds,TimeUnit.SECONDS);}catch(Exception e){job.cancel(true);throw e;}
    }
    public synchronized Started start(Long stallId,Origin origin,String detector,String owner)throws IOException{
        if(sessions.size()>=maxSessions)throw new IllegalArgumentException("实时会话已达上限，请先停止其他监测");
        VideoService.validateMode(origin,detector);
        if("yolo".equals(detector)&&(weights.isBlank()||!Files.isRegularFile(Path.of(weights))))throw new IllegalArgumentException("尚未配置可用 YOLO 权重");
        Stall stall=stalls.findById(stallId).orElseThrow(()->new IllegalArgumentException("档口不存在"));
        Files.createDirectories(storage.resolve("jobs"));
        Session s=new Session();s.id=UUID.randomUUID().toString();s.owner=owner;
        try{
            List<String> cmd=new ArrayList<>(List.of(python,"-m","zaoyan_ai.live_worker","--detector",detector,"--line",
                stall.lineX1+","+stall.lineY1+","+stall.lineX2+","+stall.lineY2,"--direction",stall.direction));
            Path ruleFile=storage.resolve("jobs").resolve(s.id+".rules.json");Files.writeString(ruleFile,stall.getRules().json());
            cmd.add("--rules");cmd.add(ruleFile.toString());
            if("yolo".equals(detector)){cmd.add("--weights");cmd.add(weights);}
            s.process=new ProcessBuilder(cmd).directory(aiRoot.toFile()).redirectError(storage.resolve("jobs").resolve(s.id+"-live.log").toFile()).start();
            s.reader=new BufferedReader(new InputStreamReader(s.process.getInputStream(),java.nio.charset.StandardCharsets.UTF_8));
            s.writer=new BufferedWriter(new OutputStreamWriter(s.process.getOutputStream(),java.nio.charset.StandardCharsets.UTF_8));
            String hello=exchange(s,null,20);
            if(hello==null||!mapper.readTree(hello).path("ready").asBoolean())throw new IllegalArgumentException("算法握手失败");
            VideoTask t=new VideoTask();t.id=s.id;t.mode="LIVE";t.detector=detector;t.status="RUNNING";t.stallId=stallId;t.origin=origin;
            t.originalFilename="实时摄像头监测";t.operatorName=owner;t.recordedAt=t.createdAt;t.attempt=1;
            t.rulesJson=stall.getRules().json();t.lineX1=stall.lineX1;t.lineY1=stall.lineY1;t.lineX2=stall.lineX2;t.lineY2=stall.lineY2;t.direction=stall.direction;
            tasks.save(t);sessions.put(s.id,s);return new Started(s.id,detector,origin,"实时算法已就绪，默认不保存原始帧");
        }catch(Exception e){s.close();throw new IllegalArgumentException("实时算法未就绪或启动超时，请检查依赖和模型配置");}
    }
    private Session owned(String id,String owner){
        Session s=sessions.get(id);if(s==null)throw new IllegalArgumentException("会话不存在或已超时");
        if(!s.owner.equals(owner))throw new AccessDeniedException("无权操作其他用户的摄像头会话");return s;
    }
    public JsonNode frame(String id,byte[] jpg,String owner)throws IOException{
        Session s=owned(id,owner);
        synchronized(s){
            if(s.closed)throw new IllegalArgumentException("会话已关闭");
            if(jpg.length==0||jpg.length>1_000_000)throw new IllegalArgumentException("单帧图像最大 1 MB");
            s.lastSeen=System.currentTimeMillis();
            try{
                String request=mapper.writeValueAsString(Map.of("image",Base64.getEncoder().encodeToString(jpg)));
                String reply=exchange(s,request,12);
                if(reply==null)throw new IOException("算法进程退出");
                JsonNode result=mapper.readTree(reply);
                if(!result.isObject()||result.has("error"))throw new IOException("图像无效或算法返回异常");
                int count=eventWriter.append(id,result.path("events"));
                ((ObjectNode)result).put("sessionCount",count);return result;
            }catch(Exception e){finish(s,"FAILED","实时通信失败或超时，会话已关闭，请重新启动");throw new IllegalArgumentException("实时通信失败或超时，会话已关闭，请重新启动");}
        }
    }
    public void stop(String id,String owner){
        Session s=sessions.get(id);
        if(s==null)return; // Idempotent stop after tab-close or timeout.
        if(!s.owner.equals(owner))throw new AccessDeniedException("无权停止其他用户的会话");
        synchronized(s){finish(s,"COMPLETED",null);}
    }
    private void finish(Session s,String status,String error){
        if(!sessions.remove(s.id,s))return;s.close();
        tasks.findById(s.id).ifPresent(t->{t.status=status;t.finishedAt=Instant.now();t.durationSeconds=java.time.Duration.between(t.recordedAt,t.finishedAt).toMillis()/1000.;t.errorMessage=error;t.progress=100;tasks.save(t);});
    }
    @Scheduled(fixedDelay=30000)public void sweep(){
        long now=System.currentTimeMillis();
        for(Session s:List.copyOf(sessions.values()))if(now-s.lastSeen>90000)synchronized(s){if(now-s.lastSeen>90000)finish(s,"COMPLETED","会话空闲超过 90 秒，已自动停止");}
    }
    @PreDestroy public void shutdown(){for(Session s:sessions.values())s.close();sessions.clear();}
}
