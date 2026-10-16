package com.zaoyan.service;
import com.zaoyan.domain.*;import com.zaoyan.repo.BusinessAuditRepository;
import org.springframework.stereotype.Service;
@Service public class BusinessLog {
    private final BusinessAuditRepository repo;
    public BusinessLog(BusinessAuditRepository repo){this.repo=repo;}
    public void add(Long stallId,Origin origin,String action,String resource,String actor,String detail){
        BusinessAudit a=new BusinessAudit();a.stallId=stallId;a.origin=origin;a.action=action;a.resourceId=resource;
        a.operatorName=actor;a.detail=detail.length()>1000?detail.substring(0,1000):detail;repo.save(a);
    }
}
