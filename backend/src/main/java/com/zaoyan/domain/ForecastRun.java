package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="forecast_runs")
public class ForecastRun {
    @Id @Column(length=36) public String id;
    public Long stallId;
    @Enumerated(EnumType.STRING) public Origin origin;
    @Column(length=16) public String mealSlot;
    @Column(length=25) public String status="QUEUED";
    @Column(columnDefinition="TEXT") public String sourceSnapshot;
    public Integer sampleSize;
    public Integer predictedQty;
    public Integer recommendedQty;
    public Double bufferRate;
    @Column(length=400) public String explanation;
    @Column(length=400) public String errorMessage;
    public Instant createdAt=Instant.now();
    public Instant finishedAt;
    public java.time.LocalDate targetDate;
    public java.time.LocalDate historyStart, historyEnd;
    public Integer lowerQty, upperQty;
    @Column(length=50) public String method;

}
