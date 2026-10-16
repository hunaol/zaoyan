package com.zaoyan.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="count_events", indexes={@Index(name="idx_event_origin_time",columnList="origin,occurredAt"), @Index(name="idx_event_task",columnList="taskId")})
public class CountEvent {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) public Long id;
    @Column(length=36) public String taskId;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) public Origin origin;
    @Column(nullable=false, length=15) public String source = "AUTO";
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) public ReviewStatus reviewStatus = ReviewStatus.PENDING;
    @Column(length=64,unique=true) public String requestKey;
    @Column(length=80) public String targetLabel;
    @Column(length=500) public String riskReasons;
    @Column(length=30) public String reviewReason;
    public Instant updatedAt = Instant.now();
    @Transient public boolean statsIncluded=true;
    public Integer trackId;
    public Double offsetSeconds;
    public Double confidence;
    @Column(length=300) public String note;
    public Instant occurredAt = Instant.now();
    public Instant createdAt = Instant.now();
}
