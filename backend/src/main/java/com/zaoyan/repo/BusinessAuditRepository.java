package com.zaoyan.repo;
import com.zaoyan.domain.BusinessAudit;
import org.springframework.data.jpa.repository.*;
public interface BusinessAuditRepository extends JpaRepository<BusinessAudit,Long>,JpaSpecificationExecutor<BusinessAudit> {}
