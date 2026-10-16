package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="review_audits")
public class ReviewAudit {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) public Long id;
    public Long eventId;
    @Column(length=40) public String operatorName;
    @Column(length=20) public String fromStatus;
    @Column(length=20) public String toStatus;
    @Column(length=300) public String note;
    @Column(length=30) public String fromReason;
    @Column(length=30) public String toReason;
    public Instant operatedAt=Instant.now();
}
