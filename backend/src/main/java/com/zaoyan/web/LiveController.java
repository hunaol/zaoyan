package com.zaoyan.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.zaoyan.domain.Origin;
import com.zaoyan.service.LiveService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.util.Map;

@RestController @RequestMapping("/api/live")
public class LiveController {
    private final LiveService live;
    public LiveController(LiveService live){this.live=live;}
    public record Start(@NotNull Long stallId,@NotNull Origin origin,String detector){}
    @PostMapping("/start")public LiveService.Started start(@Valid @RequestBody Start s,org.springframework.security.core.Authentication auth)throws IOException{
        return live.start(s.stallId(),s.origin(),s.detector()==null?"demo-color":s.detector(),auth.getName());
    }
    @PostMapping(value="/{id}/frame",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public JsonNode frame(@PathVariable String id,@RequestPart("frame")MultipartFile image,org.springframework.security.core.Authentication auth)throws IOException{
        if(image.getSize()>1_000_000)throw new IllegalArgumentException("单帧图像最大 1 MB");
        return live.frame(id,image.getBytes(),auth.getName());
    }
    @PostMapping("/{id}/stop")public Map<String,Boolean> stop(@PathVariable String id,org.springframework.security.core.Authentication auth){live.stop(id,auth.getName());return Map.of("stopped",true);}
}
