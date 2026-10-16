package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.Instant;
@Entity @Table(name="prep_records", uniqueConstraints=@UniqueConstraint(columnNames={"stallId","origin","serviceDate","mealSlot"}))
public class PrepRecord {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) public Long id;
    // Application-level revision also works for legacy rows whose revision is null.
    public Long revision=0L;
    @Column(length=30) public String verificationSource="MANUAL";
    @Column(length=36) public String sourceDraftId;
    @Column(length=64) public String sourceDigest;
    public Integer sourceEventCount, portionsPerEvent;
    public Boolean verificationStale=false;
    public Instant verifiedAt;
    @Column(length=80) public String verifiedBy;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) public Origin origin;
    public LocalDate serviceDate;
    @Column(length=16) public String mealSlot;
    public int plannedQty;
    public int preparedQty;
    // 人工核实的实际出餐份数；没有填报时为 null，不能用计划备餐量替代。
    public Integer actualQty;
    @Column(length=300) public String note;
    public Instant createdAt=Instant.now();
}
