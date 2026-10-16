package com.zaoyan;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaoyan.domain.*;
import com.zaoyan.repo.*;
import com.zaoyan.service.TaskLifecycle;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:zaoyan_business_test;MODE=MySQL;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=create-drop"})
@AutoConfigureMockMvc
class BusinessIntegrationTests {
    @Autowired MockMvc mvc;@Autowired ObjectMapper mapper;
    @Autowired CountEventRepository events;@Autowired ReviewAuditRepository audits;
    @Autowired VideoTaskRepository tasks;@Autowired ForecastRepository forecasts;
    @Autowired PrepRepository prep;@Autowired StallRepository stalls;@Autowired TaskLifecycle lifecycle;
    private String auth;private Long stallId;
    @BeforeEach void setup()throws Exception{
        audits.deleteAll();events.deleteAll();tasks.deleteAll();forecasts.deleteAll();prep.deleteAll();
        stallId=stalls.findAll().get(0).id;
        var result=mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"demo\",\"password\":\"Demo@2026\"}")).andExpect(status().isOk()).andReturn();
        auth="Bearer "+mapper.readTree(result.getResponse().getContentAsString()).path("token").asText();
    }
    private CountEvent event(Origin origin,Instant time){CountEvent e=new CountEvent();e.stallId=stallId;e.origin=origin;e.occurredAt=time;return events.save(e);}
    private VideoTask task(){VideoTask t=new VideoTask();t.id=UUID.randomUUID().toString();t.stallId=stallId;t.origin=Origin.SIMULATION;t.detector="demo-color";t.recordedAt=Instant.parse("2026-01-01T03:00:00Z");t.attempt=1;return tasks.save(t);}
    private String json(Object value)throws Exception{return mapper.writeValueAsString(value);}

    @Test void pagination_reads_beyond_two_hundred_and_isolates_origin()throws Exception{
        var rows=new ArrayList<CountEvent>();
        for(int i=0;i<225;i++){CountEvent e=new CountEvent();e.stallId=stallId;e.origin=Origin.SIMULATION;e.occurredAt=Instant.parse("2026-01-01T03:00:00Z").plusSeconds(i);rows.add(e);}
        events.saveAll(rows);event(Origin.REAL,Instant.now());
        mvc.perform(get("/api/events/search?origin=SIMULATION&page=7&size=30&date=2026-01-01").header("Authorization",auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(225)).andExpect(jsonPath("$.items.length()").value(15));
        mvc.perform(get("/api/events/search?origin=REAL").header("Authorization",auth)).andExpect(jsonPath("$.total").value(1));
        mvc.perform(get("/api/events/search?size=1001").header("Authorization",auth)).andExpect(status().isBadRequest());
    }
    @Test void batch_review_rollback_scoped_audit_and_idempotence()throws Exception{
        CountEvent sim=event(Origin.SIMULATION,Instant.now()),real=event(Origin.REAL,Instant.now());
        var bad=Map.of("origin","SIMULATION","ids",List.of(sim.id,real.id),"reviewStatus","REJECTED","note","mixed origins");
        mvc.perform(post("/api/events/review-batch").header("Authorization",auth).contentType(MediaType.APPLICATION_JSON).content(json(bad))).andExpect(status().isBadRequest());
        assertEquals(ReviewStatus.PENDING,events.findById(sim.id).orElseThrow().reviewStatus);assertEquals(0,audits.count());
        String good=json(Map.of("origin","SIMULATION","ids",List.of(sim.id,sim.id),"reviewStatus","CONFIRMED","note","review"));
        for(int i=0;i<2;i++)mvc.perform(post("/api/events/review-batch").header("Authorization",auth).contentType(MediaType.APPLICATION_JSON).content(good)).andExpect(status().isOk());
        assertEquals(1,audits.count());
        mvc.perform(get("/api/audits?origin=REAL").header("Authorization",auth)).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/audits?origin=SIMULATION&eventId="+sim.id).header("Authorization",auth)).andExpect(jsonPath("$.length()").value(1));
    }
    @Test void video_import_uses_capture_time_and_keeps_review_on_repeated_completion()throws Exception{
        VideoTask t=task();lifecycle.begin(t.id);
        var result=mapper.readTree("{\"status\":\"completed\",\"frame_count\":100,\"events\":[{\"track_id\":2,\"offset_seconds\":2.5,\"confidence\":0.9}]}");
        lifecycle.complete(t.id,result,"/tmp/placeholder.mp4");
        CountEvent e=events.findByTaskIdOrderByOccurredAtAsc(t.id).get(0);assertEquals(t.recordedAt.plusMillis(2500),e.occurredAt);
        e.reviewStatus=ReviewStatus.REJECTED;events.save(e);lifecycle.complete(t.id,result,"/tmp/placeholder.mp4");
        assertEquals(1,events.count());assertEquals(ReviewStatus.REJECTED,events.findById(e.id).orElseThrow().reviewStatus);
    }
    @Test void cancelled_task_does_not_import_late_algorithm_result()throws Exception{
        VideoTask t=task();lifecycle.begin(t.id);lifecycle.cancel(t.id);
        lifecycle.complete(t.id,mapper.readTree("{\"status\":\"completed\",\"frame_count\":10,\"events\":[{\"track_id\":1,\"offset_seconds\":0,\"confidence\":0.9}]}"),"/tmp/no.mp4");
        assertEquals(0,events.count());assertEquals("CANCELLED",tasks.findById(t.id).orElseThrow().status);
        VideoTask retry=lifecycle.retry(t.id);assertEquals("QUEUED",retry.status);assertEquals(2,retry.attempt);
    }
    @Test void invalid_algorithm_batch_rolls_back_entire_import()throws Exception{
        VideoTask t=task();lifecycle.begin(t.id);
        var result=mapper.readTree("{\"status\":\"completed\",\"frame_count\":100,\"events\":[{\"track_id\":1,\"offset_seconds\":1,\"confidence\":0.9},{\"track_id\":2,\"offset_seconds\":-1,\"confidence\":0.9}]}");
        assertThrows(IllegalArgumentException.class,()->lifecycle.complete(t.id,result,"/tmp/no.mp4"));assertEquals(0,events.count());
        assertEquals("RUNNING",tasks.findById(t.id).orElseThrow().status);
    }
    @Test void simulation_seed_never_overwrites_registered_data()throws Exception{
        LocalDate yesterday=LocalDate.now(ZoneId.of("Asia/Shanghai")).minusDays(1);
        PrepRecord row=new PrepRecord();row.stallId=stallId;row.origin=Origin.SIMULATION;row.serviceDate=yesterday;row.mealSlot="LUNCH";row.actualQty=7;prep.save(row);
        mvc.perform(post("/api/planning/seed-simulation?stallId="+stallId).header("Authorization",auth)).andExpect(status().isOk()).andExpect(jsonPath("$.created").value(7));
        mvc.perform(post("/api/planning/seed-simulation?stallId="+stallId).header("Authorization",auth)).andExpect(jsonPath("$.created").value(0));
        assertEquals(7,prep.findByStallIdAndOriginAndServiceDateAndMealSlot(stallId,Origin.SIMULATION,yesterday,"LUNCH").orElseThrow().actualQty);
        assertEquals(0,prep.findByOriginOrderByServiceDateDesc(Origin.REAL).size());
    }
    @Test void applying_forecast_changes_only_plan_not_actual_measurements()throws Exception{
        LocalDate today=LocalDate.now(ZoneId.of("Asia/Shanghai"));
        PrepRecord row=new PrepRecord();row.stallId=stallId;row.origin=Origin.SIMULATION;row.serviceDate=today;row.mealSlot="LUNCH";row.plannedQty=10;row.preparedQty=9;row.actualQty=7;prep.save(row);
        ForecastRun f=new ForecastRun();f.id=UUID.randomUUID().toString();f.stallId=stallId;f.origin=Origin.SIMULATION;f.targetDate=today;f.mealSlot="LUNCH";f.status="COMPLETED";f.recommendedQty=135;forecasts.save(f);
        mvc.perform(post("/api/planning/apply-forecast/"+f.id).header("Authorization",auth)).andExpect(status().isBadRequest());
        mvc.perform(post("/api/planning/apply-forecast/"+f.id+"?overwrite=true").header("Authorization",auth)).andExpect(status().isOk())
            .andExpect(jsonPath("$.plannedQty").value(135)).andExpect(jsonPath("$.preparedQty").value(9)).andExpect(jsonPath("$.actualQty").value(7));
    }
    @Test void daily_report_contains_midnight_and_exactly_twenty_four_hours()throws Exception{
        event(Origin.SIMULATION,Instant.parse("2026-01-01T16:00:01Z"));
        event(Origin.SIMULATION,Instant.parse("2026-01-02T15:59:59Z"));
        event(Origin.SIMULATION,Instant.parse("2026-01-02T16:00:00Z"));
        mvc.perform(get("/api/reports/daily?origin=SIMULATION&date=2026-01-02").header("Authorization",auth))
            .andExpect(status().isOk()).andExpect(jsonPath("$.count").value(2)).andExpect(jsonPath("$.hourly.length()").value(24))
            .andExpect(jsonPath("$.hourly[0].count").value(1)).andExpect(jsonPath("$.hourly[23].count").value(1));
    }
    @Test void missing_meal_slot_and_future_verified_actual_are_rejected()throws Exception{
        mvc.perform(post("/api/prep").header("Authorization",auth).contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("stallId",stallId,"origin","SIMULATION","serviceDate","2026-01-01","plannedQty",1,"preparedQty",1)))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/prep").header("Authorization",auth).contentType(MediaType.APPLICATION_JSON)
            .content(json(Map.of("stallId",stallId,"origin","SIMULATION","serviceDate",LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).toString(),"mealSlot","LUNCH","plannedQty",1,"preparedQty",1,"actualQty",1)))).andExpect(status().isBadRequest());
    }
}
