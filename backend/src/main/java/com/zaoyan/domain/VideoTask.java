package com.zaoyan.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="video_tasks", indexes={@Index(name="idx_task_time",columnList="createdAt")})
public class VideoTask {
    @Id @Column(length=36) public String id;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=20) public Origin origin;
    @Column(nullable=false,length=20) public String mode = "UPLOAD";
    @Column(nullable=false,length=28) public String status = "QUEUED";
    @Column(nullable=false,length=24) public String detector;
    @Column(length=255) public String originalFilename;
    @Column(length=600) public String inputPath;
    @Column(length=600) public String outputPath;
    public int progress = 0;
    public int rawCount = 0;
    public int frameCount = 0;
    @Column(length=1600) public String errorMessage;
    public Instant createdAt = Instant.now();
    public Instant finishedAt;
    public Instant recordedAt;
    // Immutable calibration snapshot, also used when retrying a failed upload.
    public Double lineX1, lineY1, lineX2, lineY2;
    @Column(length=10) public String direction;
    @Column(length=80) public String operatorName;
    public Integer attempt;
    @Column(length=64) public String assetId;
    public Double durationSeconds;
    @com.fasterxml.jackson.annotation.JsonIgnore @Column(columnDefinition="TEXT") public String rulesJson;
    @Transient public CountingRules getRules(){return CountingRules.parse(rulesJson);}


}
