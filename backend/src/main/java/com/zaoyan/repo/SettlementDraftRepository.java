package com.zaoyan.repo;
import com.zaoyan.domain.SettlementDraft;
import org.springframework.data.jpa.repository.*;
public interface SettlementDraftRepository extends JpaRepository<SettlementDraft,String>,JpaSpecificationExecutor<SettlementDraft> {}
