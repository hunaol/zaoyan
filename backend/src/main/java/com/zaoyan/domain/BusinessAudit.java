package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="business_audits")
public class BusinessAudit {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) public Long id;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(length=20) public Origin origin;
    @Column(length=40) public String action;
    @Column(length=80) public String resourceId,operatorName;
    @Column(length=1000) public String detail;
    public Instant operatedAt=Instant.now();
}
