package com.zaoyan.repo;
import com.zaoyan.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.Instant;
import java.util.List;
public interface CountEventRepository extends JpaRepository<CountEvent, Long>, org.springframework.data.jpa.repository.JpaSpecificationExecutor<CountEvent> {
    List<CountEvent> findTop200ByOriginOrderByOccurredAtDesc(Origin origin);
    List<CountEvent> findByOriginAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(Origin origin, Instant start, Instant end);
    List<CountEvent> findByTaskIdOrderByOccurredAtAsc(String taskId);
    java.util.Optional<CountEvent> findByRequestKey(String requestKey);
    @org.springframework.data.jpa.repository.Query("select e.stallId from CountEvent e where e.id = :id")
    java.util.Optional<Long> stallOf(@org.springframework.data.repository.query.Param("id")Long id);
    boolean existsByTaskIdAndTrackId(String taskId, Integer trackId);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select e from CountEvent e where e.id = :id")
    java.util.Optional<CountEvent> lockById(@org.springframework.data.repository.query.Param("id") Long id);
    long countByOriginAndReviewStatusNot(Origin origin, ReviewStatus reviewStatus);
}
