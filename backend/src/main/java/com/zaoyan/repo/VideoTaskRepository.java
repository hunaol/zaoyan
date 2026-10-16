package com.zaoyan.repo;
import com.zaoyan.domain.*;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.*;
public interface VideoTaskRepository extends JpaRepository<VideoTask,String>,JpaSpecificationExecutor<VideoTask> {
    List<VideoTask> findByAssetIdOrderByCreatedAtDesc(String assetId);
    List<VideoTask> findByModeAndAssetIdIsNullOrderByCreatedAtAsc(String mode);
    List<VideoTask> findByStallIdAndOrigin(Long stallId,Origin origin);
    @Query("select t.stallId from VideoTask t where t.id = :id")
    Optional<Long> stallOf(@Param("id")String id);
    List<VideoTask> findTop30ByOrderByCreatedAtDesc();
    List<VideoTask> findTop50ByOriginOrderByCreatedAtDesc(Origin origin);
    List<VideoTask> findByStatusIn(Collection<String> states);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from VideoTask t where t.id = :id")
    Optional<VideoTask> lockById(@Param("id") String id);
}
