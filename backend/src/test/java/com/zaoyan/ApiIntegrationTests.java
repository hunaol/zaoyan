package com.zaoyan;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import java.time.Instant;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:zaoyan_test;MODE=MySQL;DB_CLOSE_DELAY=-1",
  "spring.jpa.hibernate.ddl-auto=create-drop"})
@AutoConfigureMockMvc
class ApiIntegrationTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;

    private String auth(String username,String password)throws Exception{
        MvcResult resp=mvc.perform(post("/api/auth/login")
          .contentType(MediaType.APPLICATION_JSON)
          .content(mapper.writeValueAsString(java.util.Map.of("username",username,"password",password))))
          .andExpect(status().isOk()).andReturn();
        return "Bearer "+mapper.readTree(resp.getResponse().getContentAsString()).path("token").asText();
    }

    @Test void authentication_review_and_origin_isolation()throws Exception{
        mvc.perform(get("/api/dashboard?origin=SIMULATION")).andExpect(status().isUnauthorized());
        String admin=auth("demo","Demo@2026");
        String operator=auth("operator","Operator@2026");
        mvc.perform(get("/api/events?origin=SIMULATION").header("Authorization",admin))
          .andExpect(status().isOk()).andExpect(jsonPath("$").isArray());
        String body=mapper.writeValueAsString(java.util.Map.of("stallId",1,"origin","SIMULATION",
             "occurredAt",Instant.now().toString(),"note","自动化测试补录"));
        MvcResult created=mvc.perform(post("/api/events/manual").header("Authorization",admin)
          .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk())
          .andExpect(jsonPath("$.reviewStatus").value("CONFIRMED")).andReturn();
        JsonNode event=mapper.readTree(created.getResponse().getContentAsString());
        mvc.perform(get("/api/events?origin=REAL").header("Authorization",admin))
          .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(patch("/api/events/"+event.path("id").asLong()+"/review").header("Authorization",operator)
          .contentType(MediaType.APPLICATION_JSON).content("{\"reviewStatus\":\"REJECTED\",\"note\":\"审核误计\"}"))
          .andExpect(status().isOk()).andExpect(jsonPath("$.reviewStatus").value("REJECTED"));
        mvc.perform(get("/api/audits").header("Authorization",admin)).andExpect(status().isOk())
          .andExpect(jsonPath("$[0].toStatus").value("REJECTED"));
        mvc.perform(put("/api/stalls/1").header("Authorization",operator)
          .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(java.util.Map.of(
              "name","Test stall","location","Test location","lineX1",0.1,"lineY1",0.5,
              "lineX2",0.9,"lineY2",0.5,"direction","positive"))))
          .andExpect(status().isForbidden());
    }
}
