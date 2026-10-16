package com.zaoyan.repo;
import com.zaoyan.domain.ReviewAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface ReviewAuditRepository extends JpaRepository<ReviewAudit,Long>,org.springframework.data.jpa.repository.JpaSpecificationExecutor<ReviewAudit> {
    List<ReviewAudit> findTop100ByOrderByOperatedAtDesc();
    @org.springframework.data.jpa.repository.Query("select a from ReviewAudit a where a.eventId in (select e.id from CountEvent e where e.origin = :origin) and (:eventId is null or a.eventId = :eventId) order by a.operatedAt desc, a.id desc")
    List<ReviewAudit> scoped(@org.springframework.data.repository.query.Param("origin") com.zaoyan.domain.Origin origin,
        @org.springframework.data.repository.query.Param("eventId") Long eventId, org.springframework.data.domain.Pageable page);

}
