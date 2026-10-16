package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.*;
@Entity @Table(name="settlement_drafts")
public class SettlementDraft {
    @Id @Column(length=36) public String id;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(length=20) public Origin origin;
    public LocalDate serviceDate;
    @Column(length=16) public String mealSlot;
    public Instant windowStart,windowEnd;
    public int confirmedCount,pendingCount,rejectedCount,excludedCount,portionsPerEvent,suggestedQty;
    @Column(length=64) public String sourceDigest;
    public Long previousRevision,previousRecordId;
    @Column(columnDefinition="TEXT") public String coverageJson;
    @Column(length=80) public String createdBy,confirmedBy;
    public Instant createdAt=Instant.now(),expiresAt,confirmedAt;
    public Long confirmedRecordId;
    @Column(length=300) public String confirmationNote;
}
