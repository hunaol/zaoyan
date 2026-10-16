package com.zaoyan.domain;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="stalls")
public class Stall {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) public Long id;
    @Column(nullable=false, length=90) public String name;
    @Column(nullable=false, length=90) public String location;
    @Column(nullable=false) public double lineX1 = 0.08;
    @Column(nullable=false) public double lineY1 = 0.54;
    @Column(nullable=false) public double lineX2 = 0.92;
    @Column(nullable=false) public double lineY2 = 0.54;
    @Column(nullable=false, length=10) public String direction = "positive";
    @com.fasterxml.jackson.annotation.JsonIgnore @Column(columnDefinition="TEXT") public String rulesJson;
    @Transient public CountingRules getRules(){return CountingRules.parse(rulesJson);}
    public Instant createdAt = Instant.now();
}
