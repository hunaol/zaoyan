package com.zaoyan;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaoyan.domain.*;import com.zaoyan.repo.*;import com.zaoyan.service.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import java.time.*;import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual H2/service integration tests. Run with Maven; no vision model or production DB used. */
@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:zaoyan_closure_test;MODE=MySQL;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=create-drop"})
class BusinessClosureTests {
    @Autowired StallRepository stalls;@Autowired VideoTaskRepository tasks;@Autowired CountEventRepository events;
    @Autowired CaptureAssetRepository assets;@Autowired SettlementDraftRepository drafts;@Autowired PrepRepository prep;
    @Autowired BusinessAuditRepository audits;@Autowired CaptureService captures;@Autowired TaskLifecycle lifecycle;
    @Autowired SettlementService settlement;@Autowired EventScope scope;@Autowired ObjectMapper json;
    private Long sid;private final LocalDate day=LocalDate.of(2026,1,1);
    private final Instant start=Instant.parse("2026-01-01T03:00:00Z");
    @BeforeEach void reset(){drafts.deleteAll();audits.deleteAll();prep.deleteAll();events.deleteAll();tasks.deleteAll();assets.deleteAll();
        Stall s=stalls.findAll().get(0);s.rulesJson=CountingRules.defaults().json();stalls.save(s);sid=s.id;}
    private VideoTask recording(String fingerprint,boolean force){VideoTask t=new VideoTask();t.id=UUID.randomUUID().toString();t.stallId=sid;
        t.origin=Origin.SIMULATION;t.detector="demo-color";t.recordedAt=start;t.originalFilename="synthetic.mp4";t.rulesJson=CountingRules.defaults().json();
        return captures.register(t,fingerprint,force);}
    private VideoTask complete(VideoTask t,int count)throws Exception{lifecycle.begin(t.id);var rows=new ArrayList<Map<String,Object>>();
        for(int i=0;i<count;i++)rows.add(Map.of("track_id",i+1,"offset_seconds",i+1.,"confidence",.9,"target_label","tray","risk_reasons",List.of("CONTENT_UNVERIFIED")));
        lifecycle.complete(t.id,json.valueToTree(Map.of("status","completed","events",rows,"duration_seconds",60,"frame_count",1200,"fps",20)),"/not-a-real-video.mp4");return tasks.findById(t.id).orElseThrow();}
    private void confirmEvents(VideoTask t){var list=events.findByTaskIdOrderByOccurredAtAsc(t.id);list.forEach(e->e.reviewStatus=ReviewStatus.CONFIRMED);events.saveAll(list);}
    private SettlementDraft draft(){return settlement.create(sid,Origin.SIMULATION,day,"LUNCH",1,"test");}
    private PrepRecord confirm(SettlementDraft d){return settlement.confirm(d.id,true,true,true,true,"Controlled test coverage, not a real cafeteria","test");}
    @Test void duplicate_bytes_reuse_the_existing_task(){var a=recording("a",false);var b=recording("a",false);assertEquals(a.id,b.id);assertEquals(1,tasks.count());}
    @Test void new_analysis_does_not_silently_replace_active_version()throws Exception{var a=complete(recording("a",false),2);var b=complete(recording("a",true),3);
        assertTrue(scope.effective(a));assertFalse(scope.effective(b));assertEquals(a.id,assets.findById(a.assetId).orElseThrow().activeTaskId);}
    @Test void activation_preserves_events_and_switches_only_statistics()throws Exception{var a=complete(recording("a",false),2);var b=complete(recording("a",true),3);
        captures.activate(b.id,"test","new calibration");assertEquals(5,events.count());assertEquals(3,scope.effective(events.findAll()).size());assertFalse(scope.effective(a));}
    @Test void pending_events_block_confirmation()throws Exception{complete(recording("a",false),1);var d=draft();assertEquals(1,d.pendingCount);assertThrows(IllegalArgumentException.class,()->confirm(d));}
    @Test void coverage_and_units_must_be_explicit()throws Exception{var t=complete(recording("a",false),1);confirmEvents(t);var d=draft();
        assertThrows(IllegalArgumentException.class,()->settlement.confirm(d.id,false,true,true,true,"checked","test"));
        assertThrows(IllegalArgumentException.class,()->settlement.confirm(d.id,true,false,true,true,"checked","test"));}
    @Test void zero_requires_separate_confirmation(){var d=draft();assertThrows(IllegalArgumentException.class,()->settlement.confirm(d.id,true,true,false,true,"checked","test"));assertEquals(0,confirm(d).actualQty);}
    @Test void settlement_is_idempotent_and_preserves_plan_and_prepared()throws Exception{var t=complete(recording("a",false),2);confirmEvents(t);
        PrepRecord p=new PrepRecord();p.stallId=sid;p.origin=Origin.SIMULATION;p.serviceDate=day;p.mealSlot="LUNCH";p.plannedQty=8;p.preparedQty=7;prep.save(p);
        var d=draft();var first=confirm(d);var second=confirm(d);assertEquals(first.id,second.id);assertEquals(first.revision,second.revision);assertEquals(8,second.plannedQty);assertEquals(7,second.preparedQty);assertEquals(2,second.actualQty);}
    @Test void existing_verified_quantity_cannot_be_overwritten_silently(){PrepRecord p=new PrepRecord();p.stallId=sid;p.origin=Origin.SIMULATION;p.serviceDate=day;p.mealSlot="LUNCH";p.actualQty=9;prep.save(p);var d=draft();
        assertThrows(IllegalArgumentException.class,()->settlement.confirm(d.id,true,true,true,false,"checked","test"));assertEquals(9,prep.findById(p.id).orElseThrow().actualQty);}
    @Test void changed_event_invalidates_saved_draft()throws Exception{var t=complete(recording("a",false),1);confirmEvents(t);var d=draft();var e=events.findAll().get(0);e.reviewStatus=ReviewStatus.REJECTED;events.save(e);assertThrows(IllegalArgumentException.class,()->confirm(d));}
    @Test void changed_plan_revision_invalidates_saved_draft(){PrepRecord p=new PrepRecord();p.stallId=sid;p.origin=Origin.SIMULATION;p.serviceDate=day;p.mealSlot="LUNCH";prep.save(p);var d=draft();p.revision=1L;prep.save(p);assertThrows(IllegalArgumentException.class,()->confirm(d));}
    @Test void version_switch_marks_old_settlement_stale_without_erasing_it()throws Exception{var a=complete(recording("a",false),2);confirmEvents(a);var ledger=confirm(draft());var b=complete(recording("a",true),3);captures.activate(b.id,"test","version switch");
        var changed=prep.findById(ledger.id).orElseThrow();assertTrue(changed.verificationStale);assertEquals(2,changed.actualQty);assertTrue(changed.revision>ledger.revision);}
    @Test void reanalysis_completion_alone_does_not_invalidate_active_settlement()throws Exception{var a=complete(recording("a",false),2);confirmEvents(a);var p=confirm(draft());complete(recording("a",true),3);assertFalse(prep.findById(p.id).orElseThrow().verificationStale);}
    @Test void simulation_and_real_capture_keys_do_not_collide(){assertNotEquals(CaptureService.key(sid,Origin.REAL,"same"),CaptureService.key(sid,Origin.SIMULATION,"same"));}
}
