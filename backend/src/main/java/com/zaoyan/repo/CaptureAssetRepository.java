package com.zaoyan.repo;
import com.zaoyan.domain.CaptureAsset;
import org.springframework.data.jpa.repository.*;
public interface CaptureAssetRepository extends JpaRepository<CaptureAsset,String>,JpaSpecificationExecutor<CaptureAsset> {}
