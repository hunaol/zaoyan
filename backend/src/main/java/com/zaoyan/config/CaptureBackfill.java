package com.zaoyan.config;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;import com.zaoyan.service.*;
import org.springframework.stereotype.Component;import org.springframework.boot.*;import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;import org.springframework.transaction.annotation.Transactional;
import java.nio.file.*;
@Component @Order(20)
public class CaptureBackfill implements ApplicationRunner {
    private final VideoTaskRepository tasks;private final CaptureAssetRepository assets;private final Path storage;
    public CaptureBackfill(VideoTaskRepository tasks,CaptureAssetRepository assets,@Value("${app.storage-root}")String storage){this.tasks=tasks;this.assets=assets;this.storage=Path.of(storage).toAbsolutePath().normalize();}
    @Override @Transactional(isolation=org.springframework.transaction.annotation.Isolation.READ_COMMITTED) public void run(ApplicationArguments args)throws Exception{
        for(VideoTask t:tasks.findByModeAndAssetIdIsNullOrderByCreatedAtAsc("UPLOAD")){
            if(t.inputPath==null)continue;Path p=Path.of(t.inputPath).toAbsolutePath().normalize();
            if(!p.startsWith(storage)||!Files.isRegularFile(p))continue;
            String hash=CaptureService.hash(p),key=CaptureService.key(t.stallId,t.origin,hash);
            CaptureAsset a=assets.findById(key).orElse(null);
            if(a==null){a=new CaptureAsset();a.id=key;a.sha256=hash;a.stallId=t.stallId;a.origin=t.origin;a.recordedAt=t.recordedAt==null?t.createdAt:t.recordedAt;}
            if(a.activeTaskId==null&&"COMPLETED".equals(t.status))a.activeTaskId=t.id;
            assets.save(a);t.assetId=key;tasks.save(t);
        }
    }
}
