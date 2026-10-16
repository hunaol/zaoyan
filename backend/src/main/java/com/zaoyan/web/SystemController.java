package com.zaoyan.web;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
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
            p=new ProcessBuilder(python,"-m","zaoyan_ai.health",weights).directory(root.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if(!p.waitFor(10,TimeUnit.SECONDS)||p.exitValue()!=0)throw new IllegalStateException("probe failed");
            cached=mapper.readTree(p.getInputStream());
        }catch(Exception e){cached=Map.of("demoReady",false,"yoloConfigured",false,"notice","算法运行环境探测失败或超时，请检查 Python 配置与依赖");}
        finally{if(p!=null&&p.isAlive())VideoWorker.kill(p);}
        checked=System.currentTimeMillis();return cached;
    }
}
