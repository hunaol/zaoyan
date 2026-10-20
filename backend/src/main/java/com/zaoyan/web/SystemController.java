package com.zaoyan.web;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import com.zaoyan.service.VideoWorker;
@RestController @RequestMapping("/api/system")
public class SystemController {
    private final String python,weights;private final Path root;private final ObjectMapper mapper;
    private volatile Object cached;private volatile long checked;
    public SystemController(@Value("${app.python-bin}")String python,@Value("${app.ai-root}")String root,@Value("${app.weights:}")String weights,ObjectMapper mapper){
        this.python=python;this.root=Path.of(root).toAbsolutePath().normalize();this.weights=weights;this.mapper=mapper;
    }
    @GetMapping("/capabilities")public synchronized Object capabilities(){
        if(cached!=null&&System.currentTimeMillis()-checked<15000)return cached;
        Process p=null;
        try{
            // 合并 stderr 到 stdout：探测脚本可能输出中文诊断信息，
            // 而 Windows 默认编码不是 UTF-8，直接按平台编码读会乱码或抛异常。
            p=new ProcessBuilder(python,"-m","zaoyan_ai.health",weights)
                .directory(root.toFile()).redirectErrorStream(true).start();
            // 必须先把输出读完再 waitFor，否则子进程可能因为管道缓冲区写满而阻塞。
            String raw=new String(p.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
            if(!p.waitFor(10,TimeUnit.SECONDS))throw new IllegalStateException("探测超时（10 秒）");
            if(p.exitValue()!=0)throw new IllegalStateException("探测进程退出码 "+p.exitValue()+"："+tail(raw));
            // 只取最后一行有效 JSON，容忍解释器或依赖在 stdout 上留下的杂项输出。
            JsonNode node=null;
            for(String line:raw.split("\\R")){String trimmed=line.trim();
                if(trimmed.startsWith("{")){try{node=mapper.readTree(trimmed);}catch(Exception ignored){}}}
            if(node==null)throw new IllegalStateException("探测输出不是 JSON："+tail(raw));
            cached=node;
        }catch(Exception e){
            cached=Map.of("demoReady",false,"yoloConfigured",false,
                "notice","算法运行环境探测失败："+describe(e));
        }finally{if(p!=null&&p.isAlive())VideoWorker.kill(p);}
        checked=System.currentTimeMillis();return cached;
    }
    private String describe(Exception e){
        String message=e.getMessage();
        if(message==null||message.isBlank())message=e.getClass().getSimpleName();
        return message;
    }
    private String tail(String text){
        if(text==null)return "无输出";
        String flat=text.replaceAll("[\\r\\n]+"," ").trim();
        if(flat.isEmpty())return "无输出";
        return flat.length()<=300?flat:flat.substring(flat.length()-300);
    }
}
