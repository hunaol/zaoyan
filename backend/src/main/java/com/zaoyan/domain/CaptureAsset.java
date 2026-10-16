package com.zaoyan.domain;
import jakarta.persistence.*;
import java.time.Instant;
/** Same bytes + stall + origin describe ONE recording, not multiple business counts. */
@Entity @Table(name="capture_assets")
public class CaptureAsset {
    @Id @Column(length=64) public String id;
    public Long stallId;
    @Enumerated(EnumType.STRING) @Column(length=20) public Origin origin;
    @Column(length=64) public String sha256;
    @Column(length=36) public String activeTaskId;
    public Instant recordedAt;
    public Instant createdAt=Instant.now();
}
