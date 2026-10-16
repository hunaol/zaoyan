package com.zaoyan.web;
import com.zaoyan.service.VideoService;
import com.zaoyan.domain.Origin;
import com.zaoyan.repo.CountEventRepository;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
@RestController @RequestMapping("/api/tasks")
public class TaskController {
    private final VideoService tasks;private final CountEventRepository events;private final com.zaoyan.service.EventScope scope;
    public TaskController(VideoService tasks,CountEventRepository events,com.zaoyan.service.EventScope scope){this.tasks=tasks;this.events=events;this.scope=scope;}
    @PostMapping(value="/upload",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public VideoService.TaskView upload(@RequestPart("file")MultipartFile file,@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(defaultValue="demo-color")String detector,@RequestParam(defaultValue="1")Long stallId,
        @RequestParam(required=false)Instant recordedAt,Authentication auth)throws IOException{
        return tasks.upload(file,origin,detector,stallId,recordedAt,auth.getName());
    }
    @GetMapping("/search")public Object search(@RequestParam(defaultValue="SIMULATION")Origin origin,
        @RequestParam(required=false)String mode,@RequestParam(required=false)String status,@RequestParam(required=false)java.time.LocalDate date,
        @RequestParam(defaultValue="")String q,@RequestParam(defaultValue="0")int page,@RequestParam(defaultValue="10")int size){return tasks.search(origin,mode,status,date,q,page,size);}
    @PostMapping("/{id}/reanalyze")public VideoService.TaskView reanalyze(@PathVariable String id,Authentication auth)throws IOException{return tasks.reanalyze(id,auth.getName());}
    public record Activate(String note){}
    @PostMapping("/{id}/activate")public VideoService.TaskView activate(@PathVariable String id,@RequestBody Activate dto,Authentication auth){return tasks.activate(id,auth.getName(),dto.note());}
    @GetMapping public List<VideoService.TaskView> list(@RequestParam(required=false)Origin origin){return tasks.list(origin);}
    @GetMapping("/{id}")public VideoService.TaskView one(@PathVariable String id){return tasks.view(tasks.get(id));}
    @PostMapping("/{id}/retry")public VideoService.TaskView retry(@PathVariable String id){return tasks.retry(id);}
    @PostMapping("/{id}/cancel")public VideoService.TaskView cancel(@PathVariable String id){return tasks.cancel(id);}
    @GetMapping("/{id}/events")public Object events(@PathVariable String id){tasks.get(id);return scope.decorate(events.findByTaskIdOrderByOccurredAtAsc(id));}
    @GetMapping("/{id}/video")public ResponseEntity<FileSystemResource> video(@PathVariable String id,@RequestParam(defaultValue="false")boolean source){return tasks.video(id,source);}
}
